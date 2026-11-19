import {
  instantFromDb,
  instantToDb,
  moneyFromDb,
  plainDateFromDb,
  plainDateToDb,
  type PrismaTx,
  prismaTx,
} from "@pas/db";
import type { LedgerEntry, LedgerLine } from "@pas/db/client";
import {
  asId,
  Money,
  type Instant,
  newId,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import type { AccountTemplate, PayerType } from "../domain/accounts";
import { JournalEntry } from "../domain/journal";
import type { JournalRepository } from "../ports/repositories";

export async function nextSequence(db: PrismaTx, tenantId: string, kind: string): Promise<number> {
  const [row] = await db.$queryRaw<{ last_value: number }[]>`
    insert into ledger_sequences (tenant_id, kind, last_value) values (${tenantId}, ${kind}, 1)
    on conflict (tenant_id, kind) do update set last_value = ledger_sequences.last_value + 1
    returning last_value`;

  return row!.last_value;
}

const toEntry = (row: LedgerEntry, lines: readonly LedgerLine[]): JournalEntry =>
  JournalEntry.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    number: row.number,
    key: row.idempotencyKey,
    kind: row.kind,
    source: { type: row.sourceType, id: row.sourceId },
    effectiveOn: plainDateFromDb(row.effectiveOn),
    recordedAt: instantFromDb(row.recordedAt),
    actor: {
      type: row.actorType as "user" | "system" | "api",
      id: row.actorId,
      name: row.actorName,
    },
    memo: row.memo,
    reversesId: row.reversesId,
    billingEventId: row.billingEventId,
    lines: lines
      .toSorted((a, b) => a.position - b.position)
      .map((l) => ({
        account: l.accountCode,
        amount: moneyFromDb(l.amount, l.currency),
        payerType: l.payerType as PayerType | null,
        payerRef: l.payerRef,
        policyId: l.policyId,
        invoiceId: l.invoiceId,
        paymentId: l.paymentId,
        agencyId: l.agencyId,
        jurisdiction: l.jurisdiction,
      })),
  });

/**
 * Posting is exactly once per idempotency key: the entry row is inserted with ON CONFLICT DO
 * NOTHING, so a concurrent duplicate waits for the first and then finds it. Cached balances move
 * in account order (no deadlocks) with a version bump per posting.
 */
export class PrismaJournalRepository implements JournalRepository {
  async ensureChart(
    tx: Transaction,
    ctx: TenantContext,
    accounts: readonly AccountTemplate[],
    now: Instant,
  ): Promise<void> {
    await prismaTx(tx).ledgerAccount.createMany({
      data: accounts.map((a) => ({
        tenantId: ctx.tenantId,
        code: a.code,
        name: a.name,
        type: a.type,
        role: a.role,
        createdAt: instantToDb(now),
      })),
      skipDuplicates: true,
    });
  }

  async findByKey(tx: Transaction, ctx: TenantContext, key: string) {
    const db = prismaTx(tx);

    const row = await db.ledgerEntry.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: key } },
    });

    return row ? this.load(db, ctx, row) : null;
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const db = prismaTx(tx);
    const row = await db.ledgerEntry.findFirst({ where: { tenantId: ctx.tenantId, id } });

    return row ? this.load(db, ctx, row) : null;
  }

  async isReversed(tx: Transaction, ctx: TenantContext, id: string) {
    const reversal = await prismaTx(tx).ledgerEntry.findFirst({
      where: { tenantId: ctx.tenantId, reversesId: id },
      select: { id: true },
    });

    return reversal !== null;
  }

  async invoiceTotal(
    tx: Transaction,
    ctx: TenantContext,
    account: string,
    invoiceId: string,
    currency: string,
  ) {
    const row = await prismaTx(tx).ledgerLine.aggregate({
      where: { tenantId: ctx.tenantId, accountCode: account, invoiceId, currency },
      _sum: { amount: true },
    });

    return moneyFromDb(row._sum.amount ?? "0", currency);
  }

  async post(tx: Transaction, ctx: TenantContext, entry: JournalEntry) {
    const db = prismaTx(tx);
    const existing = await this.findByKey(tx, ctx, entry.key);

    if (existing) return { entry: existing, posted: false };

    const e = entry.toSnapshot();
    const number = await nextSequence(db, ctx.tenantId, "entry");

    const inserted = await db.ledgerEntry.createMany({
      data: [
        {
          id: e.id,
          tenantId: ctx.tenantId,
          number,
          idempotencyKey: e.key,
          kind: e.kind,
          sourceType: e.source.type,
          sourceId: e.source.id,
          effectiveOn: plainDateToDb(e.effectiveOn),
          recordedAt: instantToDb(e.recordedAt),
          actorType: e.actor.type,
          actorId: e.actor.id ?? null,
          actorName: e.actor.name,
          memo: e.memo,
          reversesId: e.reversesId,
          billingEventId: e.billingEventId,
        },
      ],
      skipDuplicates: true,
    });

    if (inserted.count === 0)
      return { entry: (await this.findByKey(tx, ctx, e.key))!, posted: false };

    await db.ledgerLine.createMany({
      data: e.lines.map((line, position) => ({
        id: newId(),
        tenantId: ctx.tenantId,
        entryId: e.id,
        position,
        accountCode: line.account,
        currency: line.amount.currency,
        amount: line.amount.toString(),
        effectiveOn: plainDateToDb(e.effectiveOn),
        payerType: line.payerType ?? null,
        payerRef: line.payerRef ?? null,
        policyId: line.policyId ?? null,
        invoiceId: line.invoiceId ?? null,
        paymentId: line.paymentId ?? null,
        agencyId: line.agencyId ?? null,
        jurisdiction: line.jurisdiction ?? null,
      })),
    });

    const deltas = new Map<string, Money>();

    for (const line of e.lines) {
      const key = `${line.account}|${line.amount.currency}`;
      deltas.set(key, (deltas.get(key) ?? Money.zero(line.amount.currency)).plus(line.amount));
    }

    const recordedAt = instantToDb(e.recordedAt);

    for (const [key, delta] of [...deltas].toSorted(([a], [b]) => a.localeCompare(b))) {
      const [account, currency] = key.split("|") as [string, string];

      await db.$executeRaw`
        insert into ledger_balances (tenant_id, account_code, currency, balance, version, updated_at)
        values (${ctx.tenantId}, ${account}, ${currency}, ${delta.toString()}::numeric, 1, ${recordedAt})
        on conflict (tenant_id, account_code, currency) do update
          set balance = ledger_balances.balance + excluded.balance,
              version = ledger_balances.version + 1,
              updated_at = excluded.updated_at`;
    }

    return { entry: JournalEntry.restore({ ...e, number }), posted: true };
  }

  private async load(db: PrismaTx, ctx: TenantContext, row: LedgerEntry) {
    const lines = await db.ledgerLine.findMany({
      where: { tenantId: ctx.tenantId, entryId: row.id },
    });

    return toEntry(row, lines);
  }
}

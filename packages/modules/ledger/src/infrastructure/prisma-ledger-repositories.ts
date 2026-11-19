import {
  instantFromDb,
  instantToDb,
  jsonToDb,
  moneyFromDb,
  plainDateFromDb,
  plainDateToDb,
  prismaTx,
} from "@pas/db";
import type { LedgerApplication, LedgerPayment, LedgerReceivable } from "@pas/db/client";
import {
  asId,
  conflict,
  type Instant,
  Money,
  newId,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { accountFor, type PayerType, RECEIVABLE_ACCOUNTS, type Rail } from "../domain/accounts";
import { Payment, type PaymentStatus } from "../domain/payment";
import type { RefundMethod } from "../domain/posting-rules";
import type {
  AuditRecord,
  AuditTrail,
  CommissionRecord,
  CommissionRepository,
  DepositBatchRecord,
  DepositBatchRepository,
  IdempotencyStore,
  LedgerSettings,
  LockboxItemRecord,
  LockboxRepository,
  PaymentRepository,
  ReceivableRecord,
  ReceivableRepository,
  ReconciliationRecord,
  ReconciliationRepository,
  RefundRecord,
  RefundRepository,
  SettingsRepository,
  WriteOffRecord,
  WriteOffRepository,
} from "../ports/repositories";
import { nextSequence } from "./prisma-journal-repository";

export const toReceivable = (r: LedgerReceivable): ReceivableRecord => ({
  invoiceId: r.invoiceId,
  number: r.number,
  kind: r.kind as ReceivableRecord["kind"],
  policyId: r.policyId,
  policyNumber: r.policyNumber,
  payerType: r.payerType as PayerType,
  payerRef: r.payerRef,
  payerName: r.payerName,
  jurisdiction: r.jurisdiction,
  currency: r.currency,
  total: moneyFromDb(r.total, r.currency),
  issuedOn: plainDateFromDb(r.issuedOn),
  dueOn: plainDateFromDb(r.dueOn),
  statementId: r.statementId,
  statementNumber: r.statementNumber,
  billedOn: r.billedOn ? plainDateFromDb(r.billedOn) : null,
});

export class PrismaReceivableRepository implements ReceivableRepository {
  async find(tx: Transaction, ctx: TenantContext, invoiceId: string) {
    const row = await prismaTx(tx).ledgerReceivable.findUnique({
      where: { tenantId_invoiceId: { tenantId: ctx.tenantId, invoiceId } },
    });

    return row ? toReceivable(row) : null;
  }

  async save(tx: Transaction, ctx: TenantContext, r: ReceivableRecord, now: Instant) {
    const data = {
      number: r.number,
      kind: r.kind,
      policyId: r.policyId,
      policyNumber: r.policyNumber,
      payerType: r.payerType,
      payerRef: r.payerRef,
      payerName: r.payerName,
      currency: r.currency,
      total: r.total.toString(),
      issuedOn: plainDateToDb(r.issuedOn),
      dueOn: plainDateToDb(r.dueOn),
      jurisdiction: r.jurisdiction,
      statementId: r.statementId,
      statementNumber: r.statementNumber,
      billedOn: r.billedOn ? plainDateToDb(r.billedOn) : null,
    };

    await prismaTx(tx).ledgerReceivable.upsert({
      where: { tenantId_invoiceId: { tenantId: ctx.tenantId, invoiceId: r.invoiceId } },
      create: {
        ...data,
        tenantId: ctx.tenantId,
        invoiceId: r.invoiceId,
        createdAt: instantToDb(now),
      },
      update: data,
    });
  }

  async onStatement(
    tx: Transaction,
    ctx: TenantContext,
    statement: {
      id: string;
      number: string;
      dueOn: Temporal.PlainDate;
      invoiceIds: readonly string[];
    },
  ) {
    await prismaTx(tx).ledgerReceivable.updateMany({
      where: { tenantId: ctx.tenantId, invoiceId: { in: [...statement.invoiceIds] } },
      data: {
        statementId: statement.id,
        statementNumber: statement.number,
        dueOn: plainDateToDb(statement.dueOn),
      },
    });
  }

  async balances(
    tx: Transaction,
    ctx: TenantContext,
    filter: { invoiceIds?: readonly string[] } = {},
  ) {
    const rows = await prismaTx(tx).ledgerLine.groupBy({
      by: ["invoiceId", "currency"],
      where: {
        tenantId: ctx.tenantId,
        accountCode: { in: [...RECEIVABLE_ACCOUNTS] },
        invoiceId: filter.invoiceIds ? { in: [...filter.invoiceIds] } : { not: null },
      },
      _sum: { amount: true },
    });

    return new Map(
      rows.map((r) => [r.invoiceId!, moneyFromDb(r._sum.amount ?? "0", r.currency)] as const),
    );
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: {
      payerType?: PayerType;
      payerRef?: string;
      policyId?: string;
      openOnly?: boolean;
      limit?: number;
    },
  ) {
    const rows = await prismaTx(tx).ledgerReceivable.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.payerType && { payerType: filter.payerType }),
        ...(filter.payerRef && { payerRef: filter.payerRef }),
        ...(filter.policyId && { policyId: filter.policyId }),
      },
      orderBy: [{ dueOn: "asc" }, { number: "asc" }],
      ...(filter.limit && { take: filter.limit }),
    });

    const balances = await this.balances(tx, ctx, { invoiceIds: rows.map((r) => r.invoiceId) });

    return rows
      .map((row) => {
        const r = toReceivable(row);

        return { ...r, balance: balances.get(r.invoiceId) ?? Money.zero(r.currency) };
      })
      .filter((r) => !filter.openOnly || !r.balance.isZero());
  }
}

const toPayment = (row: LedgerPayment, applications: readonly LedgerApplication[]): Payment =>
  Payment.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    number: row.number,
    rail: row.rail as Rail,
    payer: row.payerType
      ? { type: row.payerType as PayerType, ref: row.payerRef, name: row.payerName }
      : null,
    amount: moneyFromDb(row.amount, row.currency),
    applied: moneyFromDb(row.applied, row.currency),
    refunded: moneyFromDb(row.refunded, row.currency),
    receivedOn: plainDateFromDb(row.receivedOn),
    reference: row.reference,
    provider: row.provider,
    providerRef: row.providerRef,
    batchId: row.batchId,
    status: row.status as PaymentStatus,
    reversalReason: row.reversalReason,
    reversedAt: row.reversedAt ? instantFromDb(row.reversedAt) : null,
    memo: row.memo,
    version: row.version,
    applications: applications.map((a) => ({
      id: a.id,
      invoiceId: a.invoiceId,
      policyId: a.policyId,
      statementId: a.statementId,
      amount: moneyFromDb(a.amount, a.currency),
      status: a.status as "active" | "reversed",
      eventId: a.eventId,
      appliedAt: instantFromDb(a.appliedAt),
      reversedAt: a.reversedAt ? instantFromDb(a.reversedAt) : null,
    })),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });

export class PrismaPaymentRepository implements PaymentRepository {
  async nextNumber(tx: Transaction, ctx: TenantContext, kind: "payment" | "batch" | "refund") {
    return nextSequence(prismaTx(tx), ctx.tenantId, kind);
  }

  async find(tx: Transaction, ctx: TenantContext, id: string) {
    const db = prismaTx(tx);
    const row = await db.ledgerPayment.findFirst({ where: { tenantId: ctx.tenantId, id } });

    if (!row) return null;

    const applications = await db.ledgerApplication.findMany({
      where: { tenantId: ctx.tenantId, paymentId: id },
      orderBy: { appliedAt: "asc" },
    });

    return toPayment(row, applications);
  }

  async findByProvider(tx: Transaction, ctx: TenantContext, provider: string, providerRef: string) {
    const row = await prismaTx(tx).ledgerPayment.findFirst({
      where: { tenantId: ctx.tenantId, provider, providerRef },
      select: { id: true },
    });

    return row ? this.find(tx, ctx, row.id) : null;
  }

  async save(tx: Transaction, ctx: TenantContext, payment: Payment) {
    const db = prismaTx(tx);
    const p = payment.toSnapshot();

    const data = {
      payerType: p.payer?.type ?? null,
      payerRef: p.payer?.ref ?? null,
      payerName: p.payer?.name ?? null,
      applied: p.applied.toString(),
      refunded: p.refunded.toString(),
      status: p.status,
      reversalReason: p.reversalReason,
      reversedAt: p.reversedAt ? instantToDb(p.reversedAt) : null,
      updatedAt: instantToDb(p.updatedAt),
    };

    if (p.version === 0) {
      await db.ledgerPayment.create({
        data: {
          ...data,
          id: p.id,
          tenantId: ctx.tenantId,
          number: p.number,
          rail: p.rail,
          currency: p.amount.currency,
          amount: p.amount.toString(),
          receivedOn: plainDateToDb(p.receivedOn),
          reference: p.reference,
          provider: p.provider,
          providerRef: p.providerRef,
          batchId: p.batchId,
          memo: p.memo,
          version: 1,
          createdAt: instantToDb(p.createdAt),
        },
      });
    } else {
      const updated = await db.ledgerPayment.updateMany({
        where: { tenantId: ctx.tenantId, id: p.id, version: p.version },
        data: { ...data, version: p.version + 1 },
      });

      if (updated.count === 0) throw conflict(`${p.number} changed; reload and try again`);
    }

    payment.stored(p.version + 1);

    for (const a of p.applications) {
      await db.ledgerApplication.upsert({
        where: { id: a.id },
        create: {
          id: a.id,
          tenantId: ctx.tenantId,
          paymentId: p.id,
          invoiceId: a.invoiceId,
          policyId: a.policyId,
          statementId: a.statementId,
          currency: a.amount.currency,
          amount: a.amount.toString(),
          status: a.status,
          eventId: a.eventId,
          appliedAt: instantToDb(a.appliedAt),
          reversedAt: a.reversedAt ? instantToDb(a.reversedAt) : null,
        },
        update: { status: a.status, reversedAt: a.reversedAt ? instantToDb(a.reversedAt) : null },
      });
    }
  }
}

export class PrismaDepositBatchRepository implements DepositBatchRepository {
  async find(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).ledgerDepositBatch.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row ? this.toRecord(row) : null;
  }

  async openFor(tx: Transaction, ctx: TenantContext, rail: Rail) {
    const row = await prismaTx(tx).ledgerDepositBatch.findFirst({
      where: { tenantId: ctx.tenantId, rail, status: "open" },
      orderBy: { createdAt: "desc" },
    });

    return row ? this.toRecord(row) : null;
  }

  async save(tx: Transaction, ctx: TenantContext, b: DepositBatchRecord, now: Instant) {
    await prismaTx(tx).ledgerDepositBatch.upsert({
      where: { id: b.id },
      create: {
        id: b.id,
        tenantId: ctx.tenantId,
        number: b.number,
        rail: b.rail,
        status: b.status,
        depositedOn: b.depositedOn ? plainDateToDb(b.depositedOn) : null,
        createdAt: instantToDb(b.createdAt),
        updatedAt: instantToDb(now),
      },
      update: {
        status: b.status,
        depositedOn: b.depositedOn ? plainDateToDb(b.depositedOn) : null,
        updatedAt: instantToDb(now),
      },
    });
  }

  async total(tx: Transaction, ctx: TenantContext, id: string) {
    const rows = await prismaTx(tx).ledgerPayment.groupBy({
      by: ["currency"],
      where: { tenantId: ctx.tenantId, batchId: id, status: { not: "reversed" } },
      _sum: { amount: true },
    });

    const row = rows[0];

    return row ? moneyFromDb(row._sum.amount ?? "0", row.currency) : null;
  }

  private toRecord(row: {
    id: string;
    number: string;
    rail: string;
    status: string;
    depositedOn: Date | null;
    createdAt: Date;
  }): DepositBatchRecord {
    return {
      id: row.id,
      number: row.number,
      rail: row.rail as Rail,
      status: row.status as DepositBatchRecord["status"],
      depositedOn: row.depositedOn ? plainDateFromDb(row.depositedOn) : null,
      createdAt: instantFromDb(row.createdAt),
    };
  }
}

export class PrismaLockboxRepository implements LockboxRepository {
  async saveImport(
    tx: Transaction,
    ctx: TenantContext,
    input: Parameters<LockboxRepository["saveImport"]>[2],
  ) {
    await prismaTx(tx).ledgerLockboxImport.create({
      data: { ...input, tenantId: ctx.tenantId, importedAt: instantToDb(input.importedAt) },
    });
  }

  async findItem(
    tx: Transaction,
    ctx: TenantContext,
    id: string,
  ): Promise<LockboxItemRecord | null> {
    const row = await prismaTx(tx).ledgerLockboxItem.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    if (!row) return null;

    return {
      id: row.id,
      importId: row.importId,
      row: row.row,
      raw: row.raw as Record<string, string>,
      amount: moneyFromDb(row.amount, row.currency),
      reference: row.reference,
      matchedBy: row.matchedBy,
      status: row.status as LockboxItemRecord["status"],
      reason: row.reason,
      paymentId: row.paymentId,
      invoiceId: row.invoiceId,
    };
  }

  async saveItem(tx: Transaction, ctx: TenantContext, item: LockboxItemRecord, now: Instant) {
    const data = {
      matchedBy: item.matchedBy,
      status: item.status,
      reason: item.reason,
      paymentId: item.paymentId,
      invoiceId: item.invoiceId,
      updatedAt: instantToDb(now),
    };

    await prismaTx(tx).ledgerLockboxItem.upsert({
      where: { id: item.id },
      create: {
        ...data,
        id: item.id,
        tenantId: ctx.tenantId,
        importId: item.importId,
        row: item.row,
        raw: jsonToDb(item.raw),
        currency: item.amount.currency,
        amount: item.amount.toString(),
        reference: item.reference,
      },
      update: data,
    });
  }
}

export class PrismaRefundRepository implements RefundRepository {
  async find(tx: Transaction, ctx: TenantContext, id: string): Promise<RefundRecord | null> {
    const row = await prismaTx(tx).ledgerRefund.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    if (!row) return null;

    return {
      id: row.id,
      number: row.number,
      source: row.source as RefundRecord["source"],
      paymentId: row.paymentId,
      invoiceId: row.invoiceId,
      payerName: row.payerName,
      amount: moneyFromDb(row.amount, row.currency),
      method: row.method as RefundMethod,
      status: row.status as RefundRecord["status"],
      checkNumber: row.checkNumber,
      providerRef: row.providerRef,
      createdAt: instantFromDb(row.createdAt),
    };
  }

  async save(tx: Transaction, ctx: TenantContext, r: RefundRecord, now: Instant) {
    await prismaTx(tx).ledgerRefund.upsert({
      where: { id: r.id },
      create: {
        id: r.id,
        tenantId: ctx.tenantId,
        number: r.number,
        source: r.source,
        paymentId: r.paymentId,
        invoiceId: r.invoiceId,
        payerName: r.payerName,
        currency: r.amount.currency,
        amount: r.amount.toString(),
        method: r.method,
        status: r.status,
        checkNumber: r.checkNumber,
        providerRef: r.providerRef,
        createdAt: instantToDb(r.createdAt),
        updatedAt: instantToDb(now),
      },
      update: { status: r.status, checkNumber: r.checkNumber, updatedAt: instantToDb(now) },
    });
  }
}

export class PrismaWriteOffRepository implements WriteOffRepository {
  async find(tx: Transaction, ctx: TenantContext, id: string): Promise<WriteOffRecord | null> {
    const row = await prismaTx(tx).ledgerWriteOff.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    if (!row) return null;

    return {
      id: row.id,
      invoiceId: row.invoiceId,
      amount: moneyFromDb(row.amount, row.currency),
      reason: row.reason,
      status: row.status as WriteOffRecord["status"],
      requestedBy: { id: row.requestedById, name: row.requestedBy },
      decidedBy: row.decidedById ? { id: row.decidedById, name: row.decidedBy ?? "" } : null,
      createdAt: instantFromDb(row.createdAt),
    };
  }

  async save(tx: Transaction, ctx: TenantContext, w: WriteOffRecord, now: Instant) {
    await prismaTx(tx).ledgerWriteOff.upsert({
      where: { id: w.id },
      create: {
        id: w.id,
        tenantId: ctx.tenantId,
        invoiceId: w.invoiceId,
        currency: w.amount.currency,
        amount: w.amount.toString(),
        reason: w.reason,
        status: w.status,
        requestedById: w.requestedBy.id,
        requestedBy: w.requestedBy.name,
        decidedById: w.decidedBy?.id ?? null,
        decidedBy: w.decidedBy?.name ?? null,
        createdAt: instantToDb(w.createdAt),
        updatedAt: instantToDb(now),
      },
      update: {
        status: w.status,
        decidedById: w.decidedBy?.id ?? null,
        decidedBy: w.decidedBy?.name ?? null,
        updatedAt: instantToDb(now),
      },
    });
  }
}

export class PrismaSettingsRepository implements SettingsRepository {
  async find(tx: Transaction, ctx: TenantContext): Promise<LedgerSettings | null> {
    const row = await prismaTx(tx).ledgerSettings.findUnique({ where: { tenantId: ctx.tenantId } });

    if (!row) return null;

    return {
      currency: row.currency,
      receivableBasis: row.receivableBasis === "written" ? "written" : "installment",
      smallBalanceWriteOff: row.smallBalanceWriteOff
        ? moneyFromDb(row.smallBalanceWriteOff, row.currency)
        : null,
      openedAt: instantFromDb(row.openedAt),
    };
  }

  async save(tx: Transaction, ctx: TenantContext, s: LedgerSettings, now: Instant) {
    const data = {
      currency: s.currency,
      receivableBasis: s.receivableBasis,
      smallBalanceWriteOff: s.smallBalanceWriteOff?.toString() ?? null,
      updatedAt: instantToDb(now),
    };

    await prismaTx(tx).ledgerSettings.upsert({
      where: { tenantId: ctx.tenantId },
      create: { ...data, tenantId: ctx.tenantId, openedAt: instantToDb(s.openedAt) },
      update: data,
    });
  }
}

export class PrismaIdempotencyStore implements IdempotencyStore {
  async claim(
    tx: Transaction,
    ctx: TenantContext,
    input: { key: string; action: string; requestHash: string; now: Instant },
  ) {
    const db = prismaTx(tx);

    const inserted = await db.ledgerIdempotencyKey.createMany({
      data: [
        {
          tenantId: ctx.tenantId,
          key: input.key,
          action: input.action,
          requestHash: input.requestHash,
          response: jsonToDb(null),
          createdAt: instantToDb(input.now),
        },
      ],
      skipDuplicates: true,
    });

    if (inserted.count > 0) return { claimed: true as const };

    const row = await db.ledgerIdempotencyKey.findUniqueOrThrow({
      where: { tenantId_key: { tenantId: ctx.tenantId, key: input.key } },
    });

    return {
      claimed: false as const,
      action: row.action,
      requestHash: row.requestHash,
      response: row.response,
    };
  }

  async complete(tx: Transaction, ctx: TenantContext, key: string, response: unknown) {
    await prismaTx(tx).ledgerIdempotencyKey.update({
      where: { tenantId_key: { tenantId: ctx.tenantId, key } },
      data: { response: jsonToDb(response) },
    });
  }
}

export class PrismaAuditTrail implements AuditTrail {
  async record(tx: Transaction, ctx: TenantContext, entry: AuditRecord) {
    await prismaTx(tx).ledgerAuditEntry.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        occurredAt: instantToDb(entry.occurredAt),
        actorType: entry.actor.type,
        actorId: entry.actor.id ?? null,
        actorName: entry.actor.name,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: jsonToDb(entry.before),
        after: jsonToDb(entry.after),
        idempotencyKey: entry.idempotencyKey,
      },
    });
  }
}

export class PrismaReconciliationRepository implements ReconciliationRepository {
  async save(tx: Transaction, ctx: TenantContext, run: ReconciliationRecord) {
    await prismaTx(tx).ledgerReconciliation.create({
      data: {
        id: run.id,
        tenantId: ctx.tenantId,
        asOf: plainDateToDb(run.asOf),
        ranAt: instantToDb(run.ranAt),
        status: run.status,
        ledgerTotal: run.ledgerTotal.toString(),
        pasTotal: run.pasTotal.toString(),
        currency: run.ledgerTotal.currency,
        invoices: run.invoices,
        differences: jsonToDb(run.differences),
        cacheDrift: jsonToDb(run.cacheDrift),
      },
    });
  }

  async cachedVsDerived(tx: Transaction, ctx: TenantContext) {
    const db = prismaTx(tx);

    const [cached, derived] = await Promise.all([
      db.ledgerBalance.findMany({ where: { tenantId: ctx.tenantId } }),
      db.ledgerLine.groupBy({
        by: ["accountCode", "currency"],
        where: { tenantId: ctx.tenantId },
        _sum: { amount: true },
      }),
    ]);

    const key = (account: string, currency: string) => `${account}|${currency}`;

    const sums = new Map(
      derived.map((d) => [key(d.accountCode, d.currency), d._sum.amount ?? "0"]),
    );

    const keys = new Set([...cached.map((c) => key(c.accountCode, c.currency)), ...sums.keys()]);

    return [...keys].map((k) => {
      const [account, currency] = k.split("|") as [string, string];
      const row = cached.find((c) => key(c.accountCode, c.currency) === k);

      return {
        account,
        currency,
        cached: moneyFromDb(row?.balance ?? "0", currency),
        derived: moneyFromDb(sums.get(k) ?? "0", currency),
      };
    });
  }
}

export class PrismaCommissionRepository implements CommissionRepository {
  async record(tx: Transaction, ctx: TenantContext, c: CommissionRecord) {
    const created = await prismaTx(tx).ledgerCommission.createMany({
      data: [
        {
          tenantId: ctx.tenantId,
          financialTransactionId: c.financialTransactionId,
          policyId: c.policyId,
          agencyId: c.agencyId,
          currency: c.amount.currency,
          amount: c.amount.toString(),
          basis: c.basis,
          recordedAt: instantToDb(c.recordedAt),
        },
      ],
      skipDuplicates: true,
    });

    return created.count > 0;
  }

  async collectedTotals(tx: Transaction, ctx: TenantContext, policyId: string) {
    const rows = await prismaTx(tx).ledgerCommission.groupBy({
      by: ["agencyId", "currency"],
      where: { tenantId: ctx.tenantId, policyId, basis: "collected" },
      _sum: { amount: true },
    });

    return rows.map((r) => ({
      agencyId: r.agencyId,
      amount: moneyFromDb(r._sum.amount ?? "0", r.currency),
    }));
  }

  async accrued(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
    agencyId: string,
    currency: string,
  ) {
    const [row] = await prismaTx(tx).$queryRaw<{ total: string | null }[]>`
      select sum(l.amount)::text as total
      from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where l.tenant_id = ${ctx.tenantId} and l.policy_id = ${policyId}::uuid and l.agency_id = ${agencyId}
        and l.account_code = ${accountFor("commission_payable")} and l.currency = ${currency}
        and e.kind = 'commission_accrual'`;

    return moneyFromDb(row?.total ?? "0", currency).negated();
  }

  async collection(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      currency: string;
      chargeKinds: readonly string[];
      collectionKinds: readonly string[];
    },
  ) {
    const [row] = await prismaTx(tx).$queryRaw<
      { charged: string | null; collected: string | null }[]
    >`
      select
        sum(case when e.kind = any(${[...input.chargeKinds]}::text[]) then l.amount end)::text as charged,
        sum(case when e.kind = any(${[...input.collectionKinds]}::text[]) then -l.amount end)::text as collected
      from ledger_lines l join ledger_entries e on e.id = l.entry_id
      where l.tenant_id = ${ctx.tenantId} and l.policy_id = ${input.policyId}::uuid
        and l.account_code = any(${[...RECEIVABLE_ACCOUNTS]}::text[]) and l.currency = ${input.currency}`;

    return {
      charged: moneyFromDb(row?.charged ?? "0", input.currency),
      collected: moneyFromDb(row?.collected ?? "0", input.currency),
    };
  }
}

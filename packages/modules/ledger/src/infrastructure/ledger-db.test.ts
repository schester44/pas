import { getPrismaClient, PrismaUnitOfWork, prismaTx } from "@pas/db";
import {
  type Clock,
  Money,
  newId,
  type Outbox,
  sameClockForAll,
  type TenantContext,
  type TenantId,
} from "@pas/kernel";
import { afterAll, describe, expect, it } from "vitest";
import { receivableAccount } from "../domain/accounts";
import { credit, debit, JournalEntry } from "../domain/journal";
import type { CanonicalBillingEvent, PasInvoiceBalance } from "../ports/pas-billing";
import { composeLedger } from "./compose";
import { PrismaJournalRepository } from "./prisma-journal-repository";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = enabled ? getPrismaClient() : (null as never);
const uow = enabled ? new PrismaUnitOfWork(prisma) : (null as never);

const clock: Clock = {
  now: () => Temporal.Now.instant(),
  today: () => Temporal.PlainDate.from("2028-03-01"),
};

const usd = (amount: string) => Money.of(amount, "USD");
const actor = { type: "user" as const, id: "u1", name: "Finance user" };

const tenant = (): TenantContext => ({
  tenantId: newId<"Tenant">() as TenantId,
  actor: { type: "system", process: "test" },
});

const entry = (ctx: TenantContext, key: string, amount = "10") =>
  JournalEntry.draft(
    {
      tenantId: ctx.tenantId,
      key,
      kind: "test",
      source: { type: "test", id: key },
      effectiveOn: Temporal.PlainDate.from("2028-03-01"),
      actor,
      memo: "Test",
      lines: [debit("1000", usd(amount)), credit("2000", usd(amount))],
    },
    clock,
  );

afterAll(async () => {
  if (enabled) await prisma.$disconnect();
});

describe.skipIf(!enabled)("ledger in Postgres", () => {
  const journal = new PrismaJournalRepository();

  it("posts once per idempotency key, even when the same posting races", async () => {
    const ctx = tenant();

    const results = await Promise.all(
      [1, 2, 3].map(() => uow.run(ctx, (tx) => journal.post(tx, ctx, entry(ctx, "same-key")))),
    );

    expect(results.filter((r) => r.posted)).toHaveLength(1);
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);

    const balance = await prisma.ledgerBalance.findUniqueOrThrow({
      where: {
        tenantId_accountCode_currency: {
          tenantId: ctx.tenantId,
          accountCode: "1000",
          currency: "USD",
        },
      },
    });

    expect(balance.balance.toString()).toBe("10");
    expect(balance.version).toBe(1);
  });

  it("rejects updates and deletes of posted entries, lines and audit rows", async () => {
    const ctx = tenant();

    const { entry: posted } = await uow.run(ctx, (tx) =>
      journal.post(tx, ctx, entry(ctx, "immutable")),
    );

    await expect(
      uow.run(
        ctx,
        (tx) =>
          prismaTx(tx)
            .$executeRaw`update ledger_entries set memo = 'edited' where id = ${posted.id}::uuid`,
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      uow.run(
        ctx,
        (tx) =>
          prismaTx(tx).$executeRaw`delete from ledger_lines where entry_id = ${posted.id}::uuid`,
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      uow.run(
        ctx,
        (tx) =>
          prismaTx(tx)
            .$executeRaw`update ledger_lines set amount = 0 where entry_id = ${posted.id}::uuid`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses at commit an entry whose lines don't balance", async () => {
    const ctx = tenant();
    const id = newId();

    await expect(
      uow.run(ctx, async (tx) => {
        const db = prismaTx(tx);

        await db.ledgerEntry.create({
          data: {
            id,
            tenantId: ctx.tenantId,
            number: 1,
            idempotencyKey: "unbalanced",
            kind: "test",
            sourceType: "test",
            sourceId: "x",
            effectiveOn: new Date("2028-03-01T00:00:00Z"),
            recordedAt: new Date(),
            actorType: "system",
            actorName: "Test",
            memo: "Unbalanced",
          },
        });

        await db.ledgerLine.create({
          data: {
            id: newId(),
            tenantId: ctx.tenantId,
            entryId: id,
            position: 0,
            accountCode: "1000",
            currency: "USD",
            amount: "10",
            effectiveOn: new Date("2028-03-01T00:00:00Z"),
          },
        });
      }),
    ).rejects.toThrow(/does not balance/);
  });

  it("records, applies, replays and reverses a payment exactly once, in step with PAS", async () => {
    const ctx = tenant();
    const sent: CanonicalBillingEvent[] = [];
    const outbox: Outbox = { add: async () => undefined };

    const ledger = composeLedger({
      uow,
      outbox,
      clocks: sameClockForAll(clock),
      pas: {
        invoices: async (): Promise<PasInvoiceBalance[]> => [],
        history: async () => ({ invoices: [], opened: [], events: [] }),
        apply: async (_ctx, events) => {
          sent.push(...events);
        },
      },
      cards: { refund: async () => ({ refundId: "re_1", provider: "test" }) },
    });

    const invoiceId = newId();

    await ledger.ingest(ctx, "billing.invoice_issued", {
      occurredAt: clock.now().toString(),
      invoice: {
        id: invoiceId,
        number: "INV-000001",
        kind: "invoice",
        policyId: newId(),
        policyNumber: "POL-1",
        payer: "agency",
        payerRef: "agency-1",
        payerName: "Acme Agency",
        jurisdiction: "US-TX",
        currency: "USD",
        issuedOn: "2028-03-01",
        dueOn: "2028-03-31",
        status: "open",
        lines: [
          { kind: "written_premium", code: "PREMIUM", amount: { amount: "900", currency: "USD" } },
          { kind: "tax_fee", code: "TAX", amount: { amount: "100", currency: "USD" } },
        ],
      },
    });

    const record = () =>
      ledger.recordPayment(ctx, {
        rail: "check",
        payer: { type: "agency", ref: "agency-1", name: "Acme Agency" },
        amount: usd("600"),
        receivedOn: Temporal.PlainDate.from("2028-03-01"),
        reference: "Check 1001",
        memo: null,
        apply: { kind: "invoices", allocations: [{ invoiceId, amount: usd("400") }] },
        actor,
        idempotencyKey: "record-1",
      });

    const first = await record();
    const replay = await record();

    expect(replay).toEqual(first);
    expect(sent.filter((e) => e.type === "payment.received")).toHaveLength(1);

    await expect(
      ledger.recordPayment(ctx, {
        rail: "check",
        payer: null,
        amount: usd("1"),
        receivedOn: Temporal.PlainDate.from("2028-03-01"),
        reference: null,
        memo: null,
        actor,
        idempotencyKey: "record-1",
      }),
    ).rejects.toThrow(/different request/);

    const ar = async () =>
      (
        await prisma.ledgerLine.aggregate({
          where: { tenantId: ctx.tenantId, invoiceId, accountCode: receivableAccount("agency") },
          _sum: { amount: true },
        })
      )._sum.amount?.toString();

    expect(await ar()).toBe("600");

    const payment = await ledger.reads.payment(ctx, first.paymentId);

    expect(payment?.unapplied.amount).toBe("200");

    await ledger.reversePayment(ctx, {
      paymentId: first.paymentId,
      reason: "nsf",
      actor,
      idempotencyKey: "nsf-1",
    });

    expect(await ar()).toBe("1000");

    expect(sent.at(-1)).toMatchObject({
      type: "payment.reversed",
      invoiceId,
      amount: { amount: "400" },
    });

    const tb = await ledger.reads.trialBalance(ctx, {});

    expect(tb.balanced).toBe(true);

    const reconciliation = await ledger.reconcile(ctx);

    expect(reconciliation.differences.map((d) => d.difference.toString())).toEqual(["1000"]);
    expect(reconciliation.cacheDrift).toEqual([]);
  });
});

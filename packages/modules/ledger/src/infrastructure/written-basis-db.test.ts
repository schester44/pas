import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
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
import { accountFor, receivableAccount } from "../domain/accounts";
import type { PasInvoiceBalance } from "../ports/pas-billing";
import { composeLedger } from "./compose";

const enabled = Boolean(process.env.DATABASE_URL);
const prisma = enabled ? getPrismaClient() : (null as never);
const uow = enabled ? new PrismaUnitOfWork(prisma) : (null as never);

const clock: Clock = {
  now: () => Temporal.Instant.from("2028-01-01T15:00:00Z"),
  today: () => Temporal.PlainDate.from("2028-01-01"),
};

const actor = { type: "user" as const, id: "u1", name: "Finance user" };
const usd = (amount: string) => Money.of(amount, "USD");
const json = (amount: string) => ({ amount, currency: "USD" });

afterAll(async () => {
  if (enabled) await prisma.$disconnect();
});

function setup(pas: PasInvoiceBalance[] = []) {
  const ctx: TenantContext = {
    tenantId: newId<"Tenant">() as TenantId,
    actor: { type: "system", process: "test" },
  };

  const outbox: Outbox = { add: async () => undefined };

  const ledger = composeLedger({
    uow,
    outbox,
    clocks: sameClockForAll(clock),
    pas: {
      invoices: async () => pas,
      history: async () => ({ invoices: [], opened: [], events: [] }),
      apply: async () => undefined,
    },
    cards: { refund: async () => ({ refundId: "re_1", provider: "test" }) },
  });

  const policyId = newId();

  const issue = (input: {
    id: string;
    number: string;
    kind?: "invoice" | "credit_note";
    status: string;
    issuedOn: string;
    lines: { kind: string; code: string; amount: string }[];
    payer?: string;
    payerRef?: string | null;
  }) =>
    ledger.ingest(ctx, "billing.invoice_issued", {
      occurredAt: clock.now().toString(),
      invoice: {
        id: input.id,
        number: input.number,
        kind: input.kind ?? "invoice",
        policyId,
        policyNumber: "POL-1",
        payer: input.payer ?? "insured",
        payerRef: input.payerRef ?? null,
        payerName: "Pat Doe",
        jurisdiction: "US-IL",
        currency: "USD",
        issuedOn: input.issuedOn,
        dueOn: input.issuedOn,
        status: input.status,
        lines: input.lines.map((l) => ({ ...l, amount: json(l.amount) })),
      },
    });

  const applied = (input: {
    invoiceId: string;
    type: string;
    amount?: string;
    creditNoteId?: string;
    lines?: { kind: string; code: string; amount: string }[];
  }) =>
    ledger.ingest(ctx, "billing.event_applied", {
      appliedAt: clock.now().toString(),
      eventId: newId(),
      source: "pas",
      type: input.type,
      invoiceId: input.invoiceId,
      creditNoteId: input.creditNoteId ?? null,
      amount: input.amount ? json(input.amount) : null,
      lines: (input.lines ?? []).map((l) => ({ ...l, label: l.code, amount: json(l.amount) })),
    });

  const sum = async (where: { accountCode: string; invoiceId?: string; policyId?: string }) =>
    (
      await prisma.ledgerLine.aggregate({
        where: { tenantId: ctx.tenantId, ...where },
        _sum: { amount: true },
      })
    )._sum.amount?.toString() ?? "0";

  return { ctx, ledger, policyId, issue, applied, sum };
}

const premium = (amount: string) => ({ kind: "written_premium", code: "PREMIUM", amount });
const tax = (amount: string) => ({ kind: "tax_fee", code: "TAX", amount });
const fee = (amount: string) => ({ kind: "installment_fee", code: "INSTALLMENT_FEE", amount });

describe.skipIf(!enabled)("written-basis receivables", () => {
  it("books the full term at issue, fees as installments bill, and reconciles through endorsement and cancellation", async () => {
    const [first, second, third, credit] = [newId(), newId(), newId(), newId()];
    const t = setup();
    const ar = receivableAccount("insured");

    await t.issue({
      id: first,
      number: "INV-1",
      status: "open",
      issuedOn: "2028-01-01",
      lines: [premium("500"), tax("25"), fee("5")],
    });

    await t.issue({
      id: second,
      number: "INV-2",
      status: "scheduled",
      issuedOn: "2028-06-01",
      lines: [premium("500"), tax("25"), fee("5")],
    });

    await t.issue({
      id: third,
      number: "INV-3",
      status: "scheduled",
      issuedOn: "2028-09-01",
      lines: [premium("500"), tax("25"), fee("5")],
    });

    expect(await t.sum({ accountCode: ar, policyId: t.policyId })).toBe("1580");
    expect(await t.sum({ accountCode: accountFor("installment_fee_income") })).toBe("-5");

    const issued = await prisma.ledgerEntry.findFirstOrThrow({
      where: { tenantId: t.ctx.tenantId, idempotencyKey: `invoice:${second}` },
    });

    expect(issued.effectiveOn.toISOString().slice(0, 10)).toBe("2028-01-01");

    await t.ledger.recordPayment(t.ctx, {
      rail: "check",
      payer: { type: "insured", ref: null, name: "Pat Doe" },
      amount: usd("525"),
      receivedOn: Temporal.PlainDate.from("2028-01-01"),
      reference: "Check 1",
      memo: null,
      apply: { kind: "invoices", allocations: [{ invoiceId: second, amount: usd("525") }] },
      actor,
    });

    const tb = await t.ledger.reads.trialBalance(t.ctx, { asOf: "2028-01-01" });
    const arRow = tb.rows.find((r) => r.code === ar)!;

    expect(tb.balanced).toBe(true);
    expect(arRow.credit.amount).toBe("0");
    expect(arRow.debit.amount).toBe("1055");

    await t.applied({
      invoiceId: third,
      type: "invoice.adjusted",
      lines: [premium("100"), tax("5")],
    });

    await t.applied({ invoiceId: third, type: "invoice.adjusted", lines: [fee("-5")] });
    expect(await t.sum({ accountCode: ar, invoiceId: third })).toBe("630");

    await t.issue({
      id: credit,
      number: "INV-4",
      kind: "credit_note",
      status: "open",
      issuedOn: "2028-02-01",
      lines: [premium("-600"), tax("-30")],
    });

    await t.applied({
      invoiceId: third,
      type: "credit.applied",
      amount: "630",
      creditNoteId: credit,
    });

    await t.ledger.ingest(t.ctx, "billing.invoice_opened", {
      occurredAt: clock.now().toString(),
      invoiceId: third,
      billedOn: "2028-02-01",
      fee: json("0"),
    });

    expect(await t.sum({ accountCode: ar, invoiceId: third })).toBe("0");
    expect(await t.sum({ accountCode: ar, invoiceId: credit })).toBe("0");
    expect(await t.sum({ accountCode: accountFor("installment_fee_income") })).toBe("-5");
  });

  it("compares PAS balances net of fees on installments not yet billed", async () => {
    const id = newId();

    const policy = {
      policyId: newId(),
      policyNumber: "POL-2",
      payer: "insured",
      payerRef: null,
      payerName: null,
    };

    const pas: PasInvoiceBalance[] = [
      {
        invoiceId: id,
        number: "INV-9",
        kind: "invoice",
        ...policy,
        currency: "USD",
        total: usd("530"),
        balance: usd("530"),
        issuedOn: Temporal.PlainDate.from("2028-06-01"),
        dueOn: Temporal.PlainDate.from("2028-06-15"),
        status: "scheduled",
        installmentFee: usd("5"),
        unbilledFee: usd("5"),
      },
    ];

    const t = setup(pas);

    await t.issue({
      id,
      number: "INV-9",
      status: "scheduled",
      issuedOn: "2028-06-01",
      lines: [premium("500"), tax("25"), fee("5")],
    });

    const run = await t.ledger.reconcile(t.ctx);

    expect(run.differences).toEqual([]);
  });
});

describe.skipIf(!enabled)("commission payable", () => {
  it("accrues collected-basis commission in proportion to what's collected, and gives it back on NSF", async () => {
    const id = newId();
    const t = setup();

    const payable = () =>
      t.sum({ accountCode: accountFor("commission_payable"), policyId: t.policyId });

    await t.issue({
      id,
      number: "INV-1",
      status: "open",
      issuedOn: "2028-01-01",
      lines: [premium("1000")],
    });

    await t.ledger.ingest(t.ctx, "distribution.commissions_recorded", {
      occurredAt: clock.now().toString(),
      policyId: t.policyId,
      agencyId: "agency-1",
      commissionBasis: null,
      lines: [{ financialTransactionId: newId(), amount: json("100") }],
    });

    expect(await payable()).toBe("0");

    const pay = (amount: string) =>
      t.ledger.recordPayment(t.ctx, {
        rail: "check",
        payer: { type: "insured", ref: null, name: "Pat Doe" },
        amount: usd(amount),
        receivedOn: Temporal.PlainDate.from("2028-01-01"),
        reference: null,
        memo: null,
        apply: { kind: "invoices", allocations: [{ invoiceId: id, amount: usd(amount) }] },
        actor,
      });

    const partial = await pay("333.33");

    expect(await payable()).toBe("-33.33");

    await t.ledger.reversePayment(t.ctx, { paymentId: partial.paymentId, reason: "nsf", actor });
    expect(await payable()).toBe("0");

    await pay("1000");
    expect(await payable()).toBe("-100");
  });

  it("books written-basis commission at once for agency-billed business", async () => {
    const t = setup();

    await t.issue({
      id: newId(),
      number: "INV-1",
      status: "open",
      issuedOn: "2028-01-01",
      lines: [premium("1000")],
      payer: "agency",
      payerRef: "agency-1",
    });

    await t.ledger.ingest(t.ctx, "distribution.commissions_recorded", {
      occurredAt: clock.now().toString(),
      policyId: t.policyId,
      agencyId: "agency-1",
      commissionBasis: null,
      lines: [{ financialTransactionId: newId(), amount: json("150") }],
    });

    expect(
      await t.sum({ accountCode: accountFor("commission_payable"), policyId: t.policyId }),
    ).toBe("-150");
  });
});

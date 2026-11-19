import {
  type Instant,
  Money,
  type PlainDate,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { type PayerType, payerTypeOf } from "../domain/accounts";
import { type CommissionBasis, commissionBasisFor } from "../domain/commission";
import { Payment } from "../domain/payment";
import {
  applicationLines,
  type Charge,
  chargeLines,
  commissionLines,
  creditRefundLines,
  creditTransferLines,
  directReceiptLines,
  negate,
  receiptLines,
  settlementLines,
  writeOffLines,
} from "../domain/posting-rules";
import type { ReceivableRecord } from "../ports/repositories";
import { accrueCommission } from "./commission-accrual";
import { clockOf, eventKey, type LedgerDeps, NATIVE_SOURCE, post, SYSTEM } from "./deps";
import type { OpenLedger } from "./open-ledger";

export interface InvoiceIssuedFact {
  type: "billing.invoice_issued";
  occurredAt: Instant;
  invoice: {
    invoiceId: string;
    number: string;
    kind: "invoice" | "credit_note";
    policyId: string;
    policyNumber: string;
    payer: string;
    payerRef: string | null;
    payerName: string | null;
    jurisdiction: string | null;
    currency: string;
    issuedOn: PlainDate;
    dueOn: PlainDate;
    status: string;
    lines: Charge[];
  };
}

export interface InvoiceOpenedFact {
  type: "billing.invoice_opened";
  occurredAt: Instant;
  opened: { invoiceId: string; billedOn: PlainDate; fee: Money };
}

export interface EventAppliedFact {
  type: "billing.event_applied";
  occurredAt: Instant;
  event: {
    eventId: string;
    source: string;
    type: string;
    invoiceId: string;
    creditNoteId: string | null;
    amount: Money | null;
    lines: Charge[];
    provider: string | null;
    reference: string | null;
    method: { brand?: string; last4?: string } | null;
  };
}

export interface StatementIssuedFact {
  type: "billing.statement_issued";
  occurredAt: Instant;
  statement: { statementId: string; number: string; dueOn: PlainDate; invoiceIds: string[] };
}

export interface CommissionsRecordedFact {
  type: "distribution.commissions_recorded";
  occurredAt: Instant;
  commissions: {
    policyId: string;
    agencyId: string;
    commissionBasis: CommissionBasis | null;
    lines: { financialTransactionId: string; amount: Money }[];
  };
}

/** PAS's outbound billing facts (the `BillingGateway` side of PLAN §13), as the ledger reads them. */
export type BillingFact =
  | InvoiceIssuedFact
  | InvoiceOpenedFact
  | EventAppliedFact
  | StatementIssuedFact
  | CommissionsRecordedFact;

const STATEMENT_EVENT = /^ledger:stmt:([0-9a-f-]{36}):/;
const STATEMENT_CHILD = /^ledger:(reverse-)?stmt:/;

const sum = (charges: readonly Charge[], currency: string) =>
  charges.reduce((total, c) => total.plus(c.amount), Money.zero(currency));

/**
 * Mirrors PAS's billing facts into the journal, exactly once per fact. Events this ledger sent
 * itself are already posted under the same key; events from PAS's own flows (card payments at
 * bind and autopay, credit netting, spread adjustments) are posted here.
 */
export function makeIngestBillingFact(deps: LedgerDeps & { open: OpenLedger }) {
  return async function ingestBillingFact(
    ctx: TenantContext,
    fact: BillingFact,
  ): Promise<{ posted: boolean }> {
    await deps.open(ctx);

    return deps.uow.run(ctx, async (tx) => {
      const settings = await deps.settings.find(tx, ctx);

      if (!settings) throw new Error("The ledger isn't open");

      if (fact.type === "billing.invoice_issued") return invoiceIssued(deps, tx, ctx, fact);

      if (fact.type === "billing.invoice_opened") return invoiceOpened(deps, tx, ctx, fact);

      if (fact.type === "billing.statement_issued") {
        await deps.receivables.onStatement(tx, ctx, {
          id: fact.statement.statementId,
          number: fact.statement.number,
          dueOn: fact.statement.dueOn,
          invoiceIds: fact.statement.invoiceIds,
        });

        return { posted: false };
      }

      if (Temporal.Instant.compare(fact.occurredAt, settings.openedAt) < 0)
        return { posted: false };

      if (fact.type === "distribution.commissions_recorded") {
        return commissionsRecorded(deps, tx, ctx, fact);
      }

      return eventApplied(deps, tx, ctx, fact);
    });
  };
}

async function invoiceIssued(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  fact: InvoiceIssuedFact,
): Promise<{ posted: boolean }> {
  const i = fact.invoice;

  if (await deps.receivables.find(tx, ctx, i.invoiceId)) return { posted: false };

  const billed = i.status !== "scheduled";
  const charges = billed ? i.lines : withoutFees(i.lines);

  const receivable: ReceivableRecord = {
    invoiceId: i.invoiceId,
    number: i.number,
    kind: i.kind,
    policyId: i.policyId,
    policyNumber: i.policyNumber,
    payerType: payerTypeOf(i.payer),
    payerRef: i.payerRef,
    payerName: i.payerName,
    jurisdiction: i.jurisdiction,
    currency: i.currency,
    total: sum(i.lines, i.currency),
    issuedOn: i.issuedOn,
    dueOn: i.dueOn,
    statementId: null,
    statementNumber: null,
    billedOn: billed ? i.issuedOn : null,
  };

  await deps.receivables.save(tx, ctx, receivable, clockOf(deps, ctx).now());

  if (sum(charges, i.currency).isZero()) return { posted: false };

  const { posted } = await post(deps, tx, ctx, {
    key: `invoice:${i.invoiceId}`,
    kind: i.kind === "credit_note" ? "credit_note_issued" : "invoice_issued",
    source: { type: "invoice", id: i.invoiceId },
    effectiveOn: dateOf(fact.occurredAt),
    actor: SYSTEM,
    memo: `${i.kind === "credit_note" ? "Credit note" : "Invoice"} ${i.number} for ${i.policyNumber}`,
    lines: chargeLines(receivable, charges, i.currency),
  });

  return { posted };
}

/** An installment became a bill: its installment fee is owed, and earned, from now. */
async function invoiceOpened(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  fact: InvoiceOpenedFact,
): Promise<{ posted: boolean }> {
  const o = fact.opened;
  const receivable = await deps.receivables.find(tx, ctx, o.invoiceId);

  if (!receivable) throw new Error(`Invoice ${o.invoiceId} isn't in the ledger yet`);

  if (receivable.billedOn) return { posted: false };

  await deps.receivables.save(
    tx,
    ctx,
    { ...receivable, billedOn: o.billedOn },
    clockOf(deps, ctx).now(),
  );

  if (o.fee.isZero()) return { posted: false };

  const { posted } = await post(deps, tx, ctx, {
    key: `fee:${o.invoiceId}`,
    kind: "installment_fee_billed",
    source: { type: "invoice", id: o.invoiceId },
    effectiveOn: o.billedOn,
    actor: SYSTEM,
    memo: `Installment fee on ${receivable.number}`,
    lines: chargeLines(
      receivable,
      [{ kind: "installment_fee", code: "INSTALLMENT_FEE", amount: o.fee }],
      o.fee.currency,
    ),
  });

  return { posted };
}

const withoutFees = (charges: readonly Charge[]) =>
  charges.filter((c) => c.kind !== "installment_fee");

const dateOf = (instant: Instant) => instant.toZonedDateTimeISO("UTC").toPlainDate();

/**
 * Commission on written premium. Written basis: payable now, out of what the carrier is owed.
 * Collected basis: recorded, then accrued as the policy's charges are collected.
 */
async function commissionsRecorded(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  fact: CommissionsRecordedFact,
): Promise<{ posted: boolean }> {
  const c = fact.commissions;
  const clock = clockOf(deps, ctx);
  const receivables = await deps.receivables.list(tx, ctx, { policyId: c.policyId });
  const payer = receivables.find((r) => r.kind === "invoice")?.payerType ?? null;
  const basis = commissionBasisFor(c.commissionBasis, payer);
  let posted = false;

  for (const line of c.lines) {
    if (line.amount.isZero()) continue;

    await deps.commissions.record(tx, ctx, {
      financialTransactionId: line.financialTransactionId,
      policyId: c.policyId,
      agencyId: c.agencyId,
      amount: line.amount,
      basis,
      recordedAt: clock.now(),
    });

    if (basis === "collected") continue;

    const result = await post(deps, tx, ctx, {
      key: `commission:${line.financialTransactionId}`,
      kind: "commission",
      source: { type: "financial_transaction", id: line.financialTransactionId },
      effectiveOn: clock.today("UTC"),
      actor: SYSTEM,
      memo: "Agency commission on written premium",
      lines: commissionLines({ agencyId: c.agencyId, policyId: c.policyId }, line.amount),
    });

    posted ||= result.posted;
  }

  const currency = c.lines[0]?.amount.currency;

  if (basis === "collected" && currency) {
    await accrueCommission(deps, tx, ctx, {
      policyId: c.policyId,
      currency,
      trigger: `commissions:${c.lines.map((l) => l.financialTransactionId).join(",")}`,
    });
  }

  return { posted };
}

const MONEY_EVENTS = new Set([
  "payment.received",
  "payment.reversed",
  "refund.issued",
  "credit.applied",
  "credit.removed",
  "writeoff.applied",
  "writeoff.removed",
  "invoice.adjusted",
]);

async function eventApplied(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  fact: EventAppliedFact,
): Promise<{ posted: boolean }> {
  const e = fact.event;

  if (!MONEY_EVENTS.has(e.type)) return { posted: false };

  const key = eventKey(e.source, e.eventId);

  if (await deps.journal.findByKey(tx, ctx, key)) return { posted: false };

  const receivable = await deps.receivables.find(tx, ctx, e.invoiceId);

  if (!receivable) throw new Error(`Invoice ${e.invoiceId} isn't in the ledger yet`);

  const clock = clockOf(deps, ctx);
  const effectiveOn = fact.occurredAt.toZonedDateTimeISO("UTC").toPlainDate();
  const amount = e.amount ?? Money.zero(receivable.currency);

  const entry = (kind: string, memo: string, lines: ReturnType<typeof chargeLines>) =>
    post(deps, tx, ctx, {
      key,
      kind,
      source: { type: "billing_event", id: e.eventId },
      effectiveOn,
      actor: SYSTEM,
      memo,
      lines,
      billingEventId: e.eventId,
    });

  if (e.source === NATIVE_SOURCE) {
    return nativeStatementChild(deps, tx, ctx, fact, receivable, entry);
  }

  switch (e.type) {
    case "payment.received": {
      const payment = Payment.receive(
        {
          tenantId: ctx.tenantId,
          number: `PMT-${String(await deps.payments.nextNumber(tx, ctx, "payment")).padStart(6, "0")}`,
          rail: "card",
          payer: payerOf(receivable),
          amount,
          receivedOn: effectiveOn,
          reference: e.method?.last4
            ? `${e.method.brand ?? "Card"} ending ${e.method.last4}`
            : e.reference,
          provider: e.provider,
          providerRef: e.reference,
          batchId: null,
          memo: null,
        },
        clock,
      );

      payment.apply(
        { invoiceId: receivable.invoiceId, policyId: receivable.policyId, amount },
        e.eventId,
        clock,
      );

      await deps.payments.save(tx, ctx, payment);

      const { number } = payment.toSnapshot();

      return entry("payment_received", `${number} by card for ${receivable.number}`, [
        ...receiptLines(payment.toSnapshot(), amount),
        ...applicationLines(payment.toSnapshot(), receivable, amount),
      ]);
    }
    case "payment.reversed":
      return entry(
        "payment_reversed",
        `Card payment on ${receivable.number} reversed`,
        negate(directReceiptLines(receivable, amount, "card")),
      );
    case "refund.issued":
      return entry(
        "refund_issued",
        `Refund of ${receivable.number} to card`,
        creditRefundLines(receivable, amount, "provider"),
      );
    case "credit.applied":
    case "credit.removed": {
      const lines = await creditLines(deps, tx, ctx, receivable, e.creditNoteId, amount);

      return e.type === "credit.applied"
        ? entry("credit_applied", `Credit applied to ${receivable.number}`, lines)
        : entry("credit_removed", `Credit removed from ${receivable.number}`, negate(lines));
    }
    case "writeoff.applied":
      return entry(
        "write_off",
        `${receivable.number} written off`,
        writeOffLines(receivable, amount),
      );
    case "writeoff.removed":
      return entry(
        "write_off_removed",
        `Write-off on ${receivable.number} removed`,
        negate(writeOffLines(receivable, amount)),
      );
    default: {
      // PAS only adjusts installment fees before an installment bills; the bill carries the fee.
      const charges = withoutFees(e.lines);

      if (charges.every((c) => c.amount.isZero())) return { posted: false };

      return entry(
        "invoice_adjusted",
        `${receivable.number} adjusted`,
        chargeLines(receivable, charges, receivable.currency),
      );
    }
  }
}

const payerOf = (r: ReceivableRecord) => ({
  type: r.payerType as PayerType,
  ref: r.payerRef,
  name: r.payerName,
});

async function creditLines(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  receivable: ReceivableRecord,
  creditNoteId: string | null,
  amount: Money,
) {
  const from = creditNoteId ? await deps.receivables.find(tx, ctx, creditNoteId) : null;

  return from ? creditTransferLines(from, receivable, amount) : settlementLines(receivable, amount);
}

/**
 * A remittance this ledger applied to an agency statement comes back from PAS as one event per
 * item: the payment applied to each invoice, and the commission the agency kept. Reversals were
 * posted when the ledger reversed the payment.
 */
async function nativeStatementChild(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  fact: EventAppliedFact,
  receivable: ReceivableRecord,
  entry: (
    kind: string,
    memo: string,
    lines: ReturnType<typeof chargeLines>,
  ) => Promise<{ posted: boolean }>,
): Promise<{ posted: boolean }> {
  const e = fact.event;

  if (!STATEMENT_CHILD.test(e.eventId) || !e.amount) return { posted: false };

  if (e.type === "credit.applied" || e.type === "credit.removed") {
    const lines = settlementLines(receivable, e.amount);

    return e.type === "credit.applied"
      ? entry("statement_settlement", `${receivable.number} settled net of commission`, lines)
      : entry(
          "statement_settlement_removed",
          `Settlement of ${receivable.number} undone`,
          negate(lines),
        );
  }

  const match = STATEMENT_EVENT.exec(e.eventId);

  if (e.type !== "payment.received" || !match) return { posted: false };

  const payment = await deps.payments.find(tx, ctx, match[1]!);

  if (!payment) throw new Error(`Payment ${match[1]} isn't in the ledger`);

  payment.apply(
    {
      invoiceId: receivable.invoiceId,
      policyId: receivable.policyId,
      amount: e.amount,
      statementId: receivable.statementId,
    },
    e.eventId,
    clockOf(deps, ctx),
  );

  await deps.payments.save(tx, ctx, payment);

  return entry(
    "payment_applied",
    `${payment.toSnapshot().number} applied to ${receivable.number} on ${receivable.statementNumber ?? "the statement"}`,
    applicationLines(payment.toSnapshot(), receivable, e.amount),
  );
}

export type IngestBillingFact = ReturnType<typeof makeIngestBillingFact>;

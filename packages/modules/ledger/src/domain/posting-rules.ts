import { Money } from "@pas/kernel";
import { accountFor, type PayerType, type Rail, railAccount, receivableAccount } from "./accounts";
import { credit, debit, type JournalLine, type LineDimensions } from "./journal";

export type ChargeKind = "written_premium" | "tax_fee" | "installment_fee";

export interface Charge {
  kind: ChargeKind;
  code: string;
  amount: Money;
}

/** An invoice or credit note as PAS billed it: who owes it and for which policy. */
export interface Receivable {
  invoiceId: string;
  number: string;
  kind: "invoice" | "credit_note";
  policyId: string;
  policyNumber: string;
  payerType: PayerType;
  payerRef: string | null;
  jurisdiction: string | null;
}

export interface Payer {
  type: PayerType;
  ref: string | null;
  name: string | null;
}

const PAYABLE: Record<ChargeKind, Parameters<typeof accountFor>[0]> = {
  written_premium: "premium_payable",
  tax_fee: "taxes_fees_payable",
  installment_fee: "installment_fee_income",
};

export const receivableDims = (r: Receivable, extra: LineDimensions = {}): LineDimensions => ({
  payerType: r.payerType,
  payerRef: r.payerRef,
  policyId: r.policyId,
  invoiceId: r.invoiceId,
  ...extra,
});

const payerDims = (payer: Payer | null, paymentId: string): LineDimensions => ({
  payerType: payer?.type ?? null,
  payerRef: payer?.ref ?? null,
  paymentId,
});

const sum = (charges: readonly Charge[], currency: string) =>
  charges.reduce((total, c) => total.plus(c.amount), Money.zero(currency));

/**
 * What PAS billed: the payer owes the total; premium is held for the carrier, taxes and fees for
 * their jurisdiction, installment fees are earned. Credit notes and negative adjustments carry
 * negative charges, so the same rule credits the payer back.
 */
export function chargeLines(r: Receivable, charges: readonly Charge[], currency: string) {
  const byKind = (kind: ChargeKind) =>
    sum(
      charges.filter((c) => c.kind === kind),
      currency,
    );

  const lines: JournalLine[] = [
    debit(receivableAccount(r.payerType), sum(charges, currency), receivableDims(r)),
  ];

  for (const kind of Object.keys(PAYABLE) as ChargeKind[]) {
    lines.push(
      credit(accountFor(PAYABLE[kind]), byKind(kind), {
        policyId: r.policyId,
        invoiceId: r.invoiceId,
        ...(kind === "tax_fee" && { jurisdiction: r.jurisdiction }),
      }),
    );
  }

  return lines;
}

/** A balance carried over when the ledger opens on a book that already had invoices. */
export const openingLines = (r: Receivable, balance: Money): JournalLine[] => [
  debit(receivableAccount(r.payerType), balance, receivableDims(r)),
  credit(accountFor("opening_balances"), balance, { policyId: r.policyId, invoiceId: r.invoiceId }),
];

/** Money in: the rail's cash or clearing account against unapplied cash for the payer. */
export const receiptLines = (
  payment: { id: string; rail: Rail; payer: Payer | null },
  amount: Money,
): JournalLine[] => [
  debit(railAccount(payment.rail), amount, { paymentId: payment.id }),
  credit(accountFor("unapplied_cash"), amount, payerDims(payment.payer, payment.id)),
];

/** Money that went straight to an invoice, as the payment provider reports it. */
export const directReceiptLines = (r: Receivable, amount: Money, rail: Rail): JournalLine[] => [
  debit(railAccount(rail), amount, { policyId: r.policyId, invoiceId: r.invoiceId }),
  credit(receivableAccount(r.payerType), amount, receivableDims(r)),
];

/** Unapplied cash applied to an invoice. */
export const applicationLines = (
  payment: { id: string; payer: Payer | null },
  r: Receivable,
  amount: Money,
): JournalLine[] => [
  debit(accountFor("unapplied_cash"), amount, payerDims(payment.payer, payment.id)),
  credit(receivableAccount(r.payerType), amount, receivableDims(r, { paymentId: payment.id })),
];

/** A credit note's credit drawn to pay another invoice. */
export const creditTransferLines = (from: Receivable, to: Receivable, amount: Money) => [
  debit(receivableAccount(from.payerType), amount, receivableDims(from)),
  credit(receivableAccount(to.payerType), amount, receivableDims(to)),
];

/** An agency settled an item net: what it kept is commission it was owed. */
export const settlementLines = (r: Receivable, amount: Money): JournalLine[] => [
  debit(accountFor("commission_payable"), amount, {
    agencyId: r.payerRef,
    policyId: r.policyId,
    invoiceId: r.invoiceId,
  }),
  credit(receivableAccount(r.payerType), amount, receivableDims(r)),
];

export const writeOffLines = (r: Receivable, amount: Money): JournalLine[] => [
  debit(accountFor("write_off_expense"), amount, { policyId: r.policyId, invoiceId: r.invoiceId }),
  credit(receivableAccount(r.payerType), amount, receivableDims(r)),
];

export type RefundMethod = "provider" | "check";

const refundAccount = (method: RefundMethod) =>
  accountFor(method === "provider" ? "card_clearing" : "refunds_payable");

/** A credit balance paid back: to the card through the provider, or by a requested check. */
export const creditRefundLines = (r: Receivable, amount: Money, method: RefundMethod) => [
  debit(receivableAccount(r.payerType), amount, receivableDims(r)),
  credit(refundAccount(method), amount, { policyId: r.policyId, invoiceId: r.invoiceId }),
];

export const unappliedRefundLines = (
  payment: { id: string; payer: Payer | null },
  amount: Money,
  method: RefundMethod,
): JournalLine[] => [
  debit(accountFor("unapplied_cash"), amount, payerDims(payment.payer, payment.id)),
  credit(refundAccount(method), amount, { paymentId: payment.id }),
];

export const refundCheckLines = (amount: Money, dims: LineDimensions): JournalLine[] => [
  debit(accountFor("refunds_payable"), amount, dims),
  credit(accountFor("cash_operating"), amount, dims),
];

export const depositLines = (total: Money): JournalLine[] => [
  debit(accountFor("cash_operating"), total),
  credit(accountFor("undeposited_funds"), total),
];

/** The agency's commission comes out of what the carrier is owed. */
export const commissionLines = (
  input: { agencyId: string; policyId: string; invoiceId?: string | null },
  amount: Money,
): JournalLine[] => [
  debit(accountFor("premium_payable"), amount, {
    policyId: input.policyId,
    invoiceId: input.invoiceId ?? null,
  }),
  credit(accountFor("commission_payable"), amount, {
    agencyId: input.agencyId,
    policyId: input.policyId,
  }),
];

export const negate = (lines: readonly JournalLine[]): JournalLine[] =>
  lines.map((line) => ({ ...line, amount: line.amount.negated() }));

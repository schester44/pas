import type { Money } from "@pas/kernel";
import type { PayerType } from "./accounts";

export type CommissionBasis = "written" | "collected";

/** The agency's choice wins; otherwise agency bill is payable when written, direct bill as collected. */
export const commissionBasisFor = (explicit: CommissionBasis | null, payer: PayerType | null) =>
  explicit ?? (payer === "agency" ? "written" : "collected");

const withReversals = (kinds: readonly string[]): ReadonlySet<string> =>
  new Set(kinds.flatMap((kind) => [kind, `${kind}.reversed`]));

/** Entry kinds that change what was charged on a policy, and what was collected against it. */
export const CHARGE_KINDS = withReversals([
  "invoice_issued",
  "credit_note_issued",
  "invoice_adjusted",
  "opening_balance",
  "installment_fee_billed",
  "receivable_rebased",
]);

export const COLLECTION_KINDS = withReversals([
  "payment_received",
  "payment_applied",
  "payment_unapplied",
  "payment_reversed",
  "refund_issued",
  "statement_settlement",
  "statement_settlement_removed",
]);

/**
 * Collected-basis commission: the share of the commission matching the share of the charges
 * collected, capped at all of it. Nothing is payable on a policy with nothing charged.
 */
export function collectedCommission(input: {
  commission: Money;
  charged: Money;
  collected: Money;
}): Money {
  const { commission, charged, collected } = input;

  if (!charged.amount.greaterThan(0) || !collected.amount.greaterThan(0)) {
    return commission.minus(commission);
  }

  if (collected.amount.greaterThanOrEqualTo(charged.amount)) return commission;

  return commission.times(collected.amount.dividedBy(charged.amount)).round(2, "half_up");
}

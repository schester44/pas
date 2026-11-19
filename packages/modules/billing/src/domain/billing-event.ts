import type { Instant, Money } from "@pas/kernel";

/** The canonical billing events (PLAN §13): the only way money changes a PAS invoice. */
export const BILLING_EVENT_TYPES = [
  "payment.received",
  "payment.failed",
  "payment.reversed",
  "refund.issued",
  "credit.applied",
  "credit.removed",
  "writeoff.applied",
  "writeoff.removed",
  "invoice.adjusted",
  "account.delinquent",
  "account.current",
  "payment_method.updated",
] as const;

export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export interface MethodSummary {
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}

export interface AdjustmentLine {
  kind: "written_premium" | "tax_fee" | "installment_fee";
  code: string;
  label: string;
  amount: Money;
  transactionId?: string;
}

/**
 * One billing event, from PAS's own flows (`source: "pas"`) or a billing system install. It names
 * the invoice, an agency statement, or the policy by number for account-level events.
 */
export interface BillingEvent {
  eventId: string;
  source: string;
  type: BillingEventType;
  occurredAt: Instant;
  invoiceId?: string;
  /** An agency's account current: the amount is applied across its items (PLAN §13). */
  statementId?: string;
  policyNumber?: string;
  amount?: Money;
  provider?: string;
  reference?: string;
  method?: MethodSummary;
  creditNoteId?: string;
  lines?: AdjustmentLine[];
  reason?: string;
  /** Recorded and applied, but summarized on the timeline by the transaction that caused it. */
  quiet?: boolean;
  actor: { type: "user" | "system" | "api"; id?: string; name: string };
}

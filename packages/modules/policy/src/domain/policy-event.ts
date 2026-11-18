import type { Instant, PlainDate } from "@pas/kernel";

export const POLICY_EVENT_TYPES = {
  transactional: [
    "new_business",
    "endorsement",
    "cancellation",
    "cancellation_rescission",
    "reinstatement",
    "renewal",
    "rewrite",
    "reversal",
    "void",
  ],
  lifecycle: [
    "quoted",
    "bound",
    "became_effective",
    "expired",
    "pending_cancellation",
    "renewal_offered",
    "renewal_accepted",
    "non_renewal_notice",
    "eligible_for_renewal",
    "ineligible_for_renewal",
  ],
  underwriting: [
    "referred",
    "uw_approved",
    "uw_declined",
    "subjectivity_added",
    "subjectivity_cleared",
    "inspection_ordered",
    "inspection_completed",
  ],
  billing: [
    "invoice_issued",
    "payment_received",
    "payment_failed",
    "payment_reversed",
    "refund_issued",
    "write_off",
    "past_due",
  ],
  document: ["documents_generated", "signed"],
  communication: ["notice_sent", "notice_mailed"],
  service: ["change_requested"],
  note: ["note", "producer_changed", "data_corrected"],
} as const;

export type PolicyEventCategory = keyof typeof POLICY_EVENT_TYPES;
export type PolicyEventType = (typeof POLICY_EVENT_TYPES)[PolicyEventCategory][number];

export const categoryOf = (type: PolicyEventType): PolicyEventCategory =>
  (Object.keys(POLICY_EVENT_TYPES) as PolicyEventCategory[]).find((category) =>
    (POLICY_EVENT_TYPES[category] as readonly string[]).includes(type),
  )!;

export interface TimelineActor {
  type: "user" | "system" | "api";
  id?: string;
  name: string;
}

export interface PolicyEventProps {
  id: string;
  termId: string | null;
  transactionId: string | null;
  invoiceId: string | null;
  type: PolicyEventType;
  category: PolicyEventCategory;
  occurredAt: Instant;
  effectiveDate: PlainDate | null;
  actor: TimelineActor;
  summary: string;
  data: Record<string, unknown>;
}

/**
 * A transactional event names its transaction and the invoice or credit note that bills it;
 * only a premium-neutral transaction has no bill.
 */
export function assertLinked(
  event: Pick<PolicyEventProps, "category" | "transactionId" | "invoiceId" | "type" | "data">,
) {
  if (event.category !== "transactional") return;

  if (!event.transactionId || (!event.invoiceId && event.data.premiumNeutral !== true)) {
    throw new Error(`A ${event.type} event needs its transaction and invoice`);
  }
}

/** The public catalog's version: payload shapes only change in a new version. */
export const CATALOG_VERSION = "2026-11-01";

export const PUBLIC_EVENT_TYPES = [
  "submission.submitted",
  "quote.referred",
  "quote.approved",
  "quote.declined",
  "quote.bound",
  "policy.issued",
  "policy.endorsed",
  "policy.cancellation_scheduled",
  "policy.cancellation_rescinded",
  "policy.cancelled",
  "policy.reinstated",
  "invoice.issued",
  "invoice.past_due",
  "payment.received",
  "payment.failed",
  "obligation.overdue",
  "filing.rejected",
] as const;

export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number];

export const isPublicEventType = (value: string): value is PublicEventType =>
  (PUBLIC_EVENT_TYPES as readonly string[]).includes(value);

export type SubjectKind = "submission" | "policy" | "obligation";

export interface EventSubject {
  kind: SubjectKind;
  id: string;
}

/** Who a user is to the in-app feed: tenant staff, or a producer who sees only their own book. */
export type Audience = "staff" | "producer";

export const DEFAULT_IN_APP: Record<Audience, readonly PublicEventType[]> = {
  staff: [
    "quote.referred",
    "payment.failed",
    "policy.cancellation_scheduled",
    "obligation.overdue",
    "filing.rejected",
  ],
  producer: [
    "quote.referred",
    "quote.approved",
    "quote.declined",
    "policy.issued",
    "payment.failed",
    "policy.cancellation_scheduled",
  ],
};

/** Producers only ever hear about their own book, so these never reach them. */
export const STAFF_ONLY: readonly PublicEventType[] = ["obligation.overdue", "filing.rejected"];

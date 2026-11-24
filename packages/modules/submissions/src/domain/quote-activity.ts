import type { Instant } from "@pas/kernel";

export type QuoteActivityType =
  | "quoted"
  | "referred"
  | "uw_approved"
  | "uw_declined"
  | "signed"
  | "sent_to_client"
  | "disclosures_accepted"
  | "payment_failed"
  | "expired"
  | "uw_info_requested"
  | "uw_info_provided"
  | "uw_escalated"
  | "subjectivity_added"
  | "subjectivity_cleared"
  | "subjectivity_overdue"
  | "inspection_ordered"
  | "inspection_scheduled"
  | "inspection_completed"
  | "inspection_reviewed"
  | "inspection_cancelled"
  | "carrier_quoted"
  | "carrier_referred"
  | "carrier_declined"
  | "carrier_failed"
  | "carrier_submitted"
  | "carrier_confirmed";

export interface ActivityActor {
  type: "user" | "system" | "api";
  id?: string;
  name: string;
}

/** A pre-bind step worth keeping on the policy's timeline. */
export interface QuoteActivity {
  id: string;
  type: QuoteActivityType;
  category: "lifecycle" | "underwriting" | "document" | "billing" | "carrier";
  occurredAt: Instant;
  actor: ActivityActor;
  summary: string;
  data: Record<string, unknown>;
}

export const RULES_ACTOR: ActivityActor = { type: "system", name: "Underwriting rules" };

export const CATEGORY: Record<QuoteActivityType, QuoteActivity["category"]> = {
  quoted: "lifecycle",
  referred: "underwriting",
  uw_approved: "underwriting",
  uw_declined: "underwriting",
  signed: "document",
  sent_to_client: "document",
  disclosures_accepted: "document",
  payment_failed: "billing",
  expired: "lifecycle",
  uw_info_requested: "underwriting",
  uw_info_provided: "underwriting",
  uw_escalated: "underwriting",
  subjectivity_added: "underwriting",
  subjectivity_cleared: "underwriting",
  subjectivity_overdue: "underwriting",
  inspection_ordered: "underwriting",
  inspection_scheduled: "underwriting",
  inspection_completed: "underwriting",
  inspection_reviewed: "underwriting",
  inspection_cancelled: "underwriting",
  carrier_quoted: "carrier",
  carrier_referred: "carrier",
  carrier_declined: "carrier",
  carrier_failed: "carrier",
  carrier_submitted: "carrier",
  carrier_confirmed: "carrier",
};

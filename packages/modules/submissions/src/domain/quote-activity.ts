import type { Instant } from "@pas/kernel";

export type QuoteActivityType =
  | "quoted"
  | "referred"
  | "uw_approved"
  | "uw_declined"
  | "signed"
  | "payment_failed"
  | "expired";

export interface ActivityActor {
  type: "user" | "system" | "api";
  id?: string;
  name: string;
}

/** A pre-bind step worth keeping on the policy's timeline. */
export interface QuoteActivity {
  id: string;
  type: QuoteActivityType;
  category: "lifecycle" | "underwriting" | "document" | "billing";
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
  payment_failed: "billing",
  expired: "lifecycle",
};

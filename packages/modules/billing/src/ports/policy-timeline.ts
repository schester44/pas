import type { TenantContext, Transaction } from "@pas/kernel";

export interface BillingTimelineEntry {
  policyId: string;
  type: "payment_received";
  invoiceId: string;
  actor: { type: "user" | "system" | "api"; id?: string; name: string };
  summary: string;
  data: Record<string, unknown>;
}

/** The policy's timeline, written in billing's own transaction so the two never disagree. */
export interface PolicyTimeline {
  record(tx: Transaction, ctx: TenantContext, entry: BillingTimelineEntry): Promise<void>;
}

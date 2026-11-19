import type { TenantContext, Transaction } from "@pas/kernel";

export interface BillingTimelineEntry {
  policyId: string;
  type:
    | "payment_received"
    | "payment_failed"
    | "payment_reversed"
    | "refund_issued"
    | "write_off"
    | "past_due"
    | "invoice_issued"
    | "credit_applied"
    | "invoice_adjusted"
    | "payment_reminder"
    | "autopay_updated"
    | "delinquent"
    | "account_current"
    | "statement_issued"
    | "billing_method_changed"
    | "mortgagee_packet_sent"
    | "mortgagee_reminder"
    | "direct_bill_offered";
  invoiceId?: string;
  actor: { type: "user" | "system" | "api"; id?: string; name: string };
  summary: string;
  data: Record<string, unknown>;
}

/** The policy's timeline, written in billing's own transaction so the two never disagree. */
export interface PolicyTimeline {
  record(tx: Transaction, ctx: TenantContext, entry: BillingTimelineEntry): Promise<void>;
}

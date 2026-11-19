import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { BillingEvent } from "../domain/billing-event";

/** Applied billing events, one per (source, event id); `record` is false for a repeat. */
export interface BillingEventLog {
  record(
    tx: Transaction,
    ctx: TenantContext,
    event: Omit<BillingEvent, "invoiceId"> & { invoiceId: string | null; policyId: string | null },
  ): Promise<boolean>;
  findPolicyByNumber(tx: Transaction, ctx: TenantContext, number: string): Promise<string | null>;
  /** Every applied invoice-level event in the order applied, for a billing system catching up. */
  listApplied(tx: Transaction, ctx: TenantContext): Promise<AppliedBillingEvent[]>;
}

export interface AppliedBillingEvent {
  eventId: string;
  source: string;
  type: string;
  invoiceId: string;
  occurredAt: Instant;
  payload: Record<string, unknown>;
}

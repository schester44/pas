import type { TenantContext, Transaction } from "@pas/kernel";
import type { BillingEvent } from "../domain/billing-event";

/** Applied billing events, one per (source, event id); `record` is false for a repeat. */
export interface BillingEventLog {
  record(
    tx: Transaction,
    ctx: TenantContext,
    event: Omit<BillingEvent, "invoiceId"> & { invoiceId: string | null; policyId: string | null },
  ): Promise<boolean>;
  findPolicyByNumber(tx: Transaction, ctx: TenantContext, number: string): Promise<string | null>;
}

import type { TenantContext } from "@pas/kernel";

export interface NoticeAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country?: string;
}

/**
 * Sends a notice to its recipients (PLAN §17.3): email to the insured, and a letter through print
 * & mail when the rule requires mail. Proof of mailing comes back on the policy timeline.
 */
export interface NoticeDelivery {
  deliver(
    ctx: TenantContext,
    input: {
      policyId: string;
      policyNumber: string;
      transactionId: string;
      title: string;
      pdf: Uint8Array;
      delivery: string;
      recipients: readonly string[];
      insured: { name: string; address: NoticeAddress | null };
      interests: { kind: string; name: string; address: NoticeAddress | null }[];
    },
  ): Promise<{ emailed: string[]; mailed: string[] }>;
}

/** What billing says the policy owes past due; null when it has no invoices. */
export interface BillingStatus {
  pastDue(
    ctx: TenantContext,
    policyId: string,
  ): Promise<{ amount: string; currency: string } | null>;
}

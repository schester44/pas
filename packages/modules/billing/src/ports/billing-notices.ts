import type { TenantContext } from "@pas/kernel";

/** Emails the insured about their bill (reminders); returns who it went to. */
export interface BillingNotices {
  remind(
    ctx: TenantContext,
    input: { policyId: string; policyNumber: string; subject: string; text: string },
  ): Promise<string[]>;
}

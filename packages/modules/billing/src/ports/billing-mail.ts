import type { TenantContext } from "@pas/kernel";
import type { PayerAddress } from "../domain/invoice";

/** Email and print & mail for billing's own correspondence (statements, lender packets). */
export interface BillingMail {
  email(
    ctx: TenantContext,
    message: { to: string; subject: string; text: string; tag: string },
  ): Promise<void>;
  /** Mails a letter about a policy; proof of mailing lands on the policy timeline. */
  letter(
    ctx: TenantContext,
    input: {
      policyId: string;
      transactionId: string;
      title: string;
      pdf: Uint8Array;
      to: { name: string; address: PayerAddress };
    },
  ): Promise<{ mailed: boolean; trackingNumber: string | null }>;
  insuredEmails(ctx: TenantContext, policyId: string): Promise<string[]>;
  links: {
    agencyStatements(ctx: TenantContext): Promise<string>;
    policyBilling(ctx: TenantContext, policyId: string): Promise<string>;
  };
}

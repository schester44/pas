import type { TenantContext, Transaction } from "@pas/kernel";

export interface InsuredParty {
  kind: "person" | "business";
  name: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  mailingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  } | null;
}

/** Parties, called inside the issuing transaction: every bound policy has its client accounts. */
export interface PolicyParties {
  linkInsureds(
    tx: Transaction,
    ctx: TenantContext,
    input: { policyId: string; policyNumber: string; insureds: InsuredParty[] },
  ): Promise<unknown>;
}

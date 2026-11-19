import type { Money, TenantContext } from "@pas/kernel";

export interface AgencyBillCheck {
  agencyId: string | null;
  agencyName: string | null;
  available: boolean;
  reason: string | null;
}

/** Billing and distribution, seen from bind: may this producer's agency bill this premium? */
export interface AgencyBilling {
  check(
    ctx: TenantContext,
    input: { producerId: string; agencyId: string | null; amount: Money },
  ): Promise<AgencyBillCheck>;
}

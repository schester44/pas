import type { TenantContext } from "@pas/kernel";

/** Where a tenant's branded portal lives, for links in emails. */
export interface PortalLinks {
  signIn(ctx: TenantContext, input: { email: string }): Promise<{ url: string; brand: string }>;
}

import type { TenantContext } from "../tenant";

/** The tenant's adapter for an external system, resolved at call time from its integrations. */
export interface ProviderFor<T> {
  for(ctx: TenantContext): Promise<T>;
}

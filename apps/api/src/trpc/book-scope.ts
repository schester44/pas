import { bookReach } from "@pas/auth";
import type { BookScope, TenantContext } from "@pas/kernel";
import type { Context } from "./context";

/** The caller's book in a tenant (PLAN §5.7), for every scoped staff and agent procedure. */
export async function bookScopeOf(
  ctx: Context & { session: NonNullable<Context["session"]> },
  tenant: TenantContext,
): Promise<BookScope> {
  const { role } = await ctx.container.auth.api.getActiveMemberRole({
    headers: ctx.headers,
    query: { organizationId: tenant.tenantId },
  });

  return ctx.container.useCases.distribution.resolveBookScope(tenant, {
    userId: ctx.session.user.id,
    reach: bookReach(role),
  });
}

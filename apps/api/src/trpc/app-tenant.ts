import type { Permission } from "@pas/auth";
import { asId, type TenantContext } from "@pas/kernel";
import { TRPCError } from "@trpc/server";
import { authedProcedure } from "./init";

/**
 * The tenant comes from the app's host (sent by the SPA, as for `tenant.resolve`, since proxies
 * rewrite Host) or the dev slug, never the session's active org. Membership is checked after.
 */
export const appTenantProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const host =
    ctx.headers.get("x-pas-host") ?? ctx.headers.get("x-forwarded-host") ?? ctx.headers.get("host");

  const resolved = await ctx.container.useCases.tenants.resolveTenantByHost({
    host: host ?? "",
    slug: ctx.headers.get("x-pas-tenant"),
  });

  if (resolved.status !== "tenant") {
    throw new TRPCError({ code: "NOT_FOUND", message: "No tenant for this address" });
  }

  const tenant: TenantContext = {
    tenantId: asId(resolved.tenantId),
    actor: { type: "user", userId: asId(ctx.session.user.id) },
  };

  return next({ ctx: { ...ctx, tenant } });
});

/** RBAC gate against the host's tenant. Non-members are refused like members without the grant. */
export function requireAppPermission(permissions: Permission) {
  return appTenantProcedure.use(async ({ ctx, next }) => {
    const allowed = await ctx.container.auth.api
      .hasPermission({
        headers: ctx.headers,
        body: { permissions, organizationId: ctx.tenant.tenantId },
      })
      .then((result) => result.success)
      .catch(() => false);

    if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

    return next();
  });
}

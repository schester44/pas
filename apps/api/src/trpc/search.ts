import { type Permission, seesTenantBook } from "@pas/auth";
import { asId, type TenantContext } from "@pas/kernel";
import { SEARCH_TYPES, type SearchScope, type SearchType } from "@pas/search";
import { z } from "zod";
import { appTenantProcedure } from "./app-tenant";
import type { Context } from "./context";
import { tenantProcedure } from "./init";

export const searchInput = z.object({
  q: z.string().max(200),
  types: z.array(z.enum(SEARCH_TYPES)).max(SEARCH_TYPES.length).optional(),
});

type Input = z.infer<typeof searchInput>;

const NEEDS: Record<SearchType, Permission | "staff"> = {
  client: { policy: ["read"] },
  policy: { policy: ["read"] },
  invoice: { policy: ["read"] },
  submission: { submission: ["read"] },
  product: { product: ["read"] },
  member: "staff",
};

const granted = (ctx: Context, tenant: TenantContext, permissions: Permission) =>
  ctx.container.auth.api
    .hasPermission({ headers: ctx.headers, body: { permissions, organizationId: tenant.tenantId } })
    .then((result) => result.success)
    .catch(() => false);

/** Types the caller may search: RBAC per type, then staff-only types for the tenant book. */
async function allowedTypes(
  ctx: Context,
  tenant: TenantContext,
  staff: boolean,
  requested: Input["types"],
): Promise<SearchType[]> {
  const wanted = requested ?? SEARCH_TYPES;

  const checks = await Promise.all(
    wanted.map(async (type) => {
      const need = NEEDS[type];

      return need === "staff" ? staff : granted(ctx, tenant, need);
    }),
  );

  return wanted.filter((_, i) => checks[i]);
}

const scopeFor = (staff: boolean, userId: string): SearchScope =>
  staff ? { kind: "tenant" } : { kind: "producer", producerId: asId(userId) };

export const adminSearch = tenantProcedure.input(searchInput).query(async ({ ctx, input }) => {
  const { role } = await ctx.container.auth.api.getActiveMemberRole({ headers: ctx.headers });
  const staff = seesTenantBook(role);
  const types = await allowedTypes(ctx, ctx.tenant, staff, input.types);

  return ctx.container.useCases.search(ctx.tenant, scopeFor(staff, ctx.session.user.id), {
    q: input.q,
    types,
  });
});

/** Agents search their own book only; clients have no global search in the portal. */
export const appSearch = appTenantProcedure.input(searchInput).query(async ({ ctx, input }) => {
  const types = await allowedTypes(ctx, ctx.tenant, false, input.types);

  return ctx.container.useCases.search(ctx.tenant, scopeFor(false, ctx.session.user.id), {
    q: input.q,
    types,
  });
});

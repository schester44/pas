import type { Permission } from "@pas/auth";
import { asId, DomainError, type DomainErrorCode, type TenantContext } from "@pas/kernel";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({ transformer: superjson });

const CODE_MAP: Record<DomainErrorCode, TRPCError["code"]> = {
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  invalid: "BAD_REQUEST",
  forbidden: "FORBIDDEN",
  precondition_failed: "PRECONDITION_FAILED",
};

/** Map domain errors to tRPC errors; everything else is a 500 with no internals leaked. */
const errorMapping = t.middleware(async ({ next, ctx }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof DomainError) {
    const cause = result.error.cause;
    throw new TRPCError({ code: CODE_MAP[cause.code], message: cause.message, cause });
  }
  if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR") {
    ctx.container.logger.error({ err: result.error.cause ?? result.error }, "tRPC internal error");
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(errorMapping);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** Requires an active organization (tenant) and builds the TenantContext for use cases. */
export const tenantProcedure = authedProcedure.use(({ ctx, next }) => {
  const tenantId = ctx.session.session.activeOrganizationId;
  if (!tenantId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active organization" });
  }
  const tenant: TenantContext = {
    tenantId: asId(tenantId),
    actor: { type: "user", userId: asId(ctx.session.user.id) },
  };
  return next({ ctx: { ...ctx, tenant } });
});

/** RBAC gate: the member's role (built-in or tenant-defined) must grant `permissions`. */
export function requirePermission(permissions: Permission) {
  return tenantProcedure.use(async ({ ctx, next }) => {
    const result = await ctx.container.auth.api.hasPermission({
      headers: ctx.headers,
      body: { permissions },
    });
    if (!result.success) throw new TRPCError({ code: "FORBIDDEN" });
    return next();
  });
}

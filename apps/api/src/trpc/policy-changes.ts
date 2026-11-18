import { type Permission, seesTenantBook } from "@pas/auth";
import { INTEREST_KINDS } from "@pas/submissions";
import { asId, type TenantContext } from "@pas/kernel";
import type { PolicyScope, TimelineActor } from "@pas/policy";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Context } from "./context";
import { authedProcedure, router } from "./init";
import { address, amount } from "./quotes-input";

const id = z.uuid();
const date = z.iso.date();
const note = z.string().trim().max(2000).optional();
const reason = z.string().trim().min(1).max(64);

const selection = z
  .array(
    z.object({
      coverage: z.string().trim().min(1).max(64),
      exposure: z.string().trim().max(200).optional(),
      limit: amount.optional(),
      deductible: amount.optional(),
    }),
  )
  .max(200);

const interests = z
  .array(
    z.object({
      kind: z.enum(INTEREST_KINDS),
      name: z.string().trim().min(1).max(200),
      address: address.nullable(),
      reference: z.string().trim().max(100).optional(),
    }),
  )
  .max(10);

const byPolicy = z.object({ policyId: id });

type Session = NonNullable<Context["session"]>;
type Resolved = { tenant: TenantContext; scope: PolicyScope };
export type ScopeResolver = (ctx: Context & { session: Session }) => Promise<Resolved>;

async function granted(ctx: Context, tenant: TenantContext, permissions: Permission) {
  return ctx.container.auth.api
    .hasPermission({ headers: ctx.headers, body: { permissions, organizationId: tenant.tenantId } })
    .then((result) => result.success)
    .catch(() => false);
}

/** Staff: the session's active organization; the role decides tenant book or own book. */
export const staffScope: ScopeResolver = async (ctx) => {
  const tenantId = ctx.session.session.activeOrganizationId;

  if (!tenantId)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No active organization" });

  const tenant: TenantContext = {
    tenantId: asId(tenantId),
    actor: { type: "user", userId: asId(ctx.session.user.id) },
  };

  if (!(await granted(ctx, tenant, { policy: ["read"] })))
    throw new TRPCError({ code: "FORBIDDEN" });

  const { role } = await ctx.container.auth.api.getActiveMemberRole({ headers: ctx.headers });

  return {
    tenant,
    scope: seesTenantBook(role)
      ? { kind: "tenant" }
      : { kind: "producer", producerId: asId(ctx.session.user.id) },
  };
};

/**
 * Mid-term changes (PLAN §7.4): endorsements, cancellations, rescissions and reinstatements.
 * `transaction:create` starts one; `transaction:issue` (plus `uw:approve` for referrals) issues
 * it, and without that it waits for approval.
 */
const uc = (ctx: Context) => ctx.container.useCases.policies;

export function policyChangesRouter(resolve: ScopeResolver) {
  const base = authedProcedure.use(async ({ ctx, next }) =>
    next({ ctx: { ...ctx, ...(await resolve(ctx)) } }),
  );

  const creator = base.use(async ({ ctx, next }) => {
    if (!(await granted(ctx, ctx.tenant, { transaction: ["create"] })))
      throw new TRPCError({ code: "FORBIDDEN" });

    const [issue, approveReferrals] = await Promise.all([
      granted(ctx, ctx.tenant, { transaction: ["issue"] }),
      granted(ctx, ctx.tenant, { uw: ["approve"] }),
    ]);

    const actor: TimelineActor = {
      type: "user",
      id: ctx.session.user.id,
      name: ctx.session.user.name,
    };

    return next({ ctx: { ...ctx, actor, authority: { issue, approveReferrals } } });
  });

  return router({
    authority: base.input(byPolicy).query(async ({ ctx }) => {
      const [create, issue, approveReferrals] = await Promise.all([
        granted(ctx, ctx.tenant, { transaction: ["create"] }),
        granted(ctx, ctx.tenant, { transaction: ["issue"] }),
        granted(ctx, ctx.tenant, { uw: ["approve"] }),
      ]);

      return { create, issue, approveReferrals };
    }),
    endorsementSetup: base
      .input(byPolicy)
      .query(({ ctx, input }) => uc(ctx).endorsementSetup(ctx.tenant, ctx.scope, input)),
    quoteEndorsement: creator
      .input(
        byPolicy.extend({
          transactionId: id.optional(),
          effectiveDate: date,
          risk: z.record(z.string(), z.unknown()).optional(),
          coverages: selection.optional(),
          parties: z
            .object({
              mailingAddress: address.nullable().optional(),
              additionalInterests: interests.optional(),
            })
            .optional(),
          note,
        }),
      )
      .mutation(({ ctx, input }) => {
        const { note: text, parties, ...rest } = input;

        return uc(ctx).quoteEndorsement(ctx.tenant, ctx.scope, {
          ...rest,
          ...(parties && {
            parties: {
              ...(parties.mailingAddress !== undefined && {
                mailingAddress: parties.mailingAddress,
              }),
              ...(parties.additionalInterests && {
                additionalInterests: parties.additionalInterests,
              }),
            },
          }),
          ...(text && { note: text }),
          actor: ctx.actor,
        });
      }),
    issue: creator.input(byPolicy.extend({ transactionId: id })).mutation(({ ctx, input }) =>
      uc(ctx).issueTransaction(ctx.tenant, ctx.scope, {
        ...input,
        actor: ctx.actor,
        authority: ctx.authority,
      }),
    ),
    discard: creator
      .input(byPolicy.extend({ transactionId: id, note }))
      .mutation(({ ctx, input }) =>
        uc(ctx).discardTransaction(ctx.tenant, ctx.scope, {
          policyId: input.policyId,
          transactionId: input.transactionId,
          actor: ctx.actor,
          ...(input.note && { note: input.note }),
        }),
      ),
    cancellationReasons: base
      .input(byPolicy)
      .query(({ ctx, input }) => uc(ctx).cancellationReasons(ctx.tenant, ctx.scope, input)),
    quoteCancellation: base
      .input(byPolicy.extend({ reason, effectiveDate: date.optional() }))
      .query(({ ctx, input }) => uc(ctx).quoteCancellation(ctx.tenant, ctx.scope, input)),
    initiateCancellation: creator
      .input(byPolicy.extend({ reason, effectiveDate: date, note }))
      .mutation(({ ctx, input }) =>
        uc(ctx).initiateCancellation(ctx.tenant, ctx.scope, {
          policyId: input.policyId,
          reason: input.reason,
          effectiveDate: input.effectiveDate,
          ...(input.note && { note: input.note }),
          actor: ctx.actor,
          authority: ctx.authority,
        }),
      ),
    rescindCancellation: creator.input(byPolicy.extend({ note })).mutation(({ ctx, input }) =>
      uc(ctx).rescindCancellation(ctx.tenant, ctx.scope, {
        policyId: input.policyId,
        ...(input.note && { note: input.note }),
        actor: ctx.actor,
        canIssue: ctx.authority.issue,
      }),
    ),
    quoteReinstatement: base
      .input(byPolicy.extend({ lapse: z.boolean(), effectiveDate: date.optional() }))
      .query(({ ctx, input }) => uc(ctx).quoteReinstatement(ctx.tenant, ctx.scope, input)),
    reinstate: creator
      .input(byPolicy.extend({ lapse: z.boolean(), effectiveDate: date.optional(), note }))
      .mutation(({ ctx, input }) =>
        uc(ctx).reinstate(ctx.tenant, ctx.scope, {
          policyId: input.policyId,
          lapse: input.lapse,
          ...(input.effectiveDate && { effectiveDate: input.effectiveDate }),
          ...(input.note && { note: input.note }),
          actor: ctx.actor,
          authority: ctx.authority,
        }),
      ),
  });
}

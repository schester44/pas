import type { Permission } from "@pas/auth";
import {
  AGENCY_STATUSES,
  COMMISSION_BASES,
  PRODUCER_STATUSES,
  REMITTANCE_BASES,
} from "@pas/distribution";
import type { TenantContext } from "@pas/kernel";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookScopeOf } from "./book-scope";
import type { Context } from "./context";
import { assertPermission, requirePermission, router } from "./init";

const id = z.uuid();
const date = z.iso.date();
const text = (max = 200) => z.string().trim().max(max);
const optionalText = (max = 200) => text(max).nullable();
const country = z.string().regex(/^[A-Z]{2}$/);
const subdivision = z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/);
const lines = z.array(text(80).min(1)).max(30);

const agencyInput = z.object({
  id: id.optional(),
  parentId: id.nullable(),
  name: text().min(1),
  legalName: optionalText(),
  fein: optionalText(20),
  address: z
    .object({
      line1: text().min(1),
      line2: text().optional(),
      city: text().min(1),
      region: text(40).min(1),
      postalCode: text(20).min(1),
      country,
    })
    .nullable(),
  phone: optionalText(40),
  email: optionalText(254),
  status: z.enum(AGENCY_STATUSES),
  tier: text(40),
  billing: z.object({
    eligible: z.boolean(),
    remittanceDays: z.number().int().min(0).max(365).nullable(),
    creditLimit: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable(),
    remittanceBasis: z.enum(REMITTANCE_BASES).default("gross"),
    commissionBasis: z.enum(COMMISSION_BASES).nullable().default(null),
    statementDay: z.number().int().min(1).max(31).nullable().default(null),
    reminderDays: z.number().int().min(0).max(365).nullable().default(null),
    suspendAfterDays: z.number().int().min(1).max(365).nullable().default(null),
    nonpaymentCancels: z.boolean().default(false),
  }),
});

const membership = z.object({
  agencyId: id,
  role: z.enum(["producer", "admin"]),
  primary: z.boolean(),
});

const licenseInput = z.object({
  id: id.optional(),
  producerId: id,
  country,
  subdivision,
  licenseNumber: text(60).min(1),
  linesOfAuthority: lines.min(1),
  effectiveDate: date,
  expirationDate: date.nullable(),
  status: z.enum(["active", "inactive"]),
});

const scheduleInput = z.object({
  id: id.optional(),
  productId: id.nullable(),
  country,
  subdivision: subdivision.nullable(),
  business: z.enum(["new", "renewal"]).nullable(),
  tier: optionalText(40),
  rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/),
  effectiveDate: date,
  expirationDate: date.nullable(),
});

type Authed = Context & { session: NonNullable<Context["session"]>; tenant: TenantContext };

const uc = (ctx: Context) => ctx.container.useCases.distribution;

/** RBAC first, then the caller's book decides which agencies they reach (PLAN §5.7). */
const scoped = (permissions: Permission) =>
  requirePermission(permissions).use(async ({ ctx, next }) =>
    next({ ctx: { ...ctx, scope: await bookScopeOf(ctx, ctx.tenant) } }),
  );

const staffOnly = (permissions: Permission) =>
  scoped(permissions).use(({ ctx, next }) => {
    if (ctx.scope.kind !== "tenant") throw new TRPCError({ code: "FORBIDDEN" });

    return next();
  });

/** Creates the Better Auth invitation for a producer who isn't a tenant member yet. */
async function invitationFor(ctx: Authed, email: string, role: "producer" | "admin") {
  const body = {
    email,
    role: role === "admin" ? "agency_admin" : "agent",
    organizationId: ctx.tenant.tenantId,
  } as const;

  const invitation = await ctx.container.auth.api
    .createInvitation({ headers: ctx.headers, body })
    .catch(() =>
      ctx.container.auth.api.createInvitation({
        headers: ctx.headers,
        body: { ...body, resend: true },
      }),
    );

  return { id: invitation.id, expiresAt: new Date(invitation.expiresAt).toISOString() };
}

/** Distribution (PLAN §4): agencies, producers, licensing, commissions and statements. */
export const distributionRouter = router({
  scope: scoped({ agency: ["read"] }).query(({ ctx }) => ctx.scope),

  agencies: router({
    list: scoped({ agency: ["read"] }).query(({ ctx }) =>
      uc(ctx).agencies.list(ctx.tenant, ctx.scope),
    ),
    get: scoped({ agency: ["read"] })
      .input(z.object({ id }))
      .query(({ ctx, input }) => uc(ctx).agencies.get(ctx.tenant, ctx.scope, input)),
    save: scoped({ agency: ["write"] })
      .input(agencyInput)
      .mutation(({ ctx, input }) => uc(ctx).agencies.save(ctx.tenant, ctx.scope, input)),
  }),

  producers: router({
    get: scoped({ agency: ["read"] })
      .input(z.object({ id }))
      .query(({ ctx, input }) => uc(ctx).producers.get(ctx.tenant, ctx.scope, input)),
    save: scoped({ agency: ["write"] })
      .input(
        z.object({
          id,
          name: text().min(1),
          producerNumber: optionalText(40),
          npn: optionalText(20),
          status: z.enum(PRODUCER_STATUSES),
          memberships: z.array(membership).max(50),
        }),
      )
      .mutation(({ ctx, input }) => uc(ctx).producers.save(ctx.tenant, ctx.scope, input)),
    invite: scoped({ agency: ["write"] })
      .input(
        z.object({
          agencyId: id,
          name: text(),
          email: z.email().max(254),
          role: z.enum(["producer", "admin"]),
          npn: optionalText(20),
          producerNumber: optionalText(40),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await uc(ctx).producers.invite(ctx.tenant, ctx.scope, input);

        return {
          producer: result.producer,
          invitation: result.needsInvitation
            ? await invitationFor(ctx, input.email, input.role)
            : null,
        };
      }),
    saveLicense: scoped({ agency: ["write"] })
      .input(licenseInput)
      .mutation(({ ctx, input }) => uc(ctx).producers.saveLicense(ctx.tenant, ctx.scope, input)),
    removeLicense: scoped({ agency: ["write"] })
      .input(z.object({ producerId: id, licenseId: id }))
      .mutation(({ ctx, input }) => uc(ctx).producers.removeLicense(ctx.tenant, ctx.scope, input)),
  }),

  appointments: router({
    save: staffOnly({ agency: ["write"] })
      .input(
        z.object({
          agencyId: id.nullable(),
          producerId: id.nullable(),
          carrier: text().min(1),
          country,
          subdivision,
          effectiveDate: date,
        }),
      )
      .mutation(({ ctx, input }) =>
        uc(ctx).producers.saveAppointment(ctx.tenant, ctx.scope, input),
      ),
  }),

  rules: router({
    schedules: staffOnly({ agency: ["read"] }).query(({ ctx }) =>
      uc(ctx).rules.schedules(ctx.tenant),
    ),
    saveSchedule: staffOnly({ agency: ["write"] })
      .input(scheduleInput)
      .mutation(({ ctx, input }) => uc(ctx).rules.saveSchedule(ctx.tenant, input)),
    removeSchedule: staffOnly({ agency: ["write"] })
      .input(z.object({ id }))
      .mutation(({ ctx, input }) => uc(ctx).rules.removeSchedule(ctx.tenant, input)),
    requirements: staffOnly({ agency: ["read"] }).query(({ ctx }) =>
      uc(ctx).rules.requirements(ctx.tenant),
    ),
    saveRequirement: staffOnly({ agency: ["write"] })
      .input(
        z.object({
          productId: id,
          mode: z.enum(["block", "warn", "off"]),
          linesOfAuthority: lines,
        }),
      )
      .mutation(({ ctx, input }) => uc(ctx).rules.saveRequirement(ctx.tenant, input)),
  }),

  statement: scoped({ agency: ["read"] })
    .input(z.object({ agencyId: id, from: date, to: date, includeSubAgencies: z.boolean() }))
    .query(({ ctx, input }) => uc(ctx).statements.statement(ctx.tenant, ctx.scope, input)),

  policyCommissions: scoped({ policy: ["read"] })
    .input(z.object({ policyId: id }))
    .query(async ({ ctx, input }) => {
      await ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, {
        id: input.policyId,
      });

      return uc(ctx).statements.forPolicy(ctx.tenant, input);
    }),

  /** Broker of record change: moves the policy to a producer and one of their agencies. */
  changeProducer: scoped({ policy: ["update"] })
    .input(
      z.object({
        policyId: id,
        producerId: id,
        agencyId: id,
        effectiveDate: date,
        reason: text(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPermission(ctx, { agency: ["read"] });

      const producer = await uc(ctx).producers.get(ctx.tenant, ctx.scope, { id: input.producerId });
      const agency = producer.memberships.find((m) => m.agencyId === input.agencyId);

      if (!producer.userId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${producer.name} hasn't joined yet`,
        });
      }

      if (!agency) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${producer.name} isn't in that agency`,
        });
      }

      return ctx.container.useCases.policies.changeProducer(ctx.tenant, ctx.scope, {
        policyId: input.policyId,
        producer: {
          id: producer.userId,
          name: producer.name,
          agencyId: agency.agencyId,
          agencyName: agency.agencyName,
        },
        effectiveDate: input.effectiveDate,
        reason: input.reason,
        actor: { type: "user", id: ctx.session.user.id, name: ctx.session.user.name },
      });
    }),
});

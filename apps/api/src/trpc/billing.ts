import { type BookScope, Money, newId, type TenantContext } from "@pas/kernel";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookScopeOf } from "./book-scope";
import type { Context } from "./context";
import { requirePermission, router } from "./init";

const uc = (ctx: Context) => ctx.container.useCases.billing;
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const STATUSES = ["open", "partially_paid", "paid", "past_due", "credit"] as const;

const statementRead = requirePermission({ billing: ["read"] }).use(async ({ ctx, next }) =>
  next({ ctx: { ...ctx, scope: await bookScopeOf(ctx, ctx.tenant) } }),
);

const staffBilling = requirePermission({ billing: ["read", "write"] }).use(
  async ({ ctx, next }) => {
    const scope = await bookScopeOf(ctx, ctx.tenant);

    if (scope.kind !== "tenant") throw new TRPCError({ code: "FORBIDDEN" });

    return next({ ctx: { ...ctx, scope } });
  },
);

const amount = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3),
});

/** Simulated events from the billing system, only where no real billing system posts them. */
const simulateInput = z
  .object({
    invoiceId: z.uuid().optional(),
    statementId: z.uuid().optional(),
    type: z.enum([
      "payment.received",
      "payment.reversed",
      "credit.applied",
      "writeoff.applied",
      "account.delinquent",
      "account.current",
    ]),
    amount: amount.optional(),
    reference: z.string().trim().max(120).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((i) => Boolean(i.invoiceId) !== Boolean(i.statementId), {
    message: "Name an invoice or a statement",
  });

type Scoped = Context & { tenant: TenantContext; scope: BookScope };

const covers = (scope: BookScope, agencyId: string) =>
  scope.kind === "tenant" || (scope.kind === "agencies" && scope.agencyIds.includes(agencyId));

const statementsInput = z.object({
  agencyId: z.uuid().optional(),
  statuses: z.array(z.enum(STATUSES)).max(5).optional(),
});

/** Account current statements within the caller's book (staff: all; agency admins: theirs). */
export const statementQueries = {
  input: statementsInput,
  list(ctx: Scoped, input: z.infer<typeof statementsInput>) {
    if (ctx.scope.kind === "producer") return [];

    const agencyIds =
      ctx.scope.kind === "agencies"
        ? ctx.scope.agencyIds.filter((id) => !input.agencyId || id === input.agencyId)
        : input.agencyId
          ? [input.agencyId]
          : undefined;

    return uc(ctx).statements.list(ctx.tenant, {
      ...(agencyIds && { agencyIds }),
      ...(input.statuses && { statuses: input.statuses }),
    });
  },
  async get(ctx: Scoped, input: { id: string }) {
    const statement = await uc(ctx).statements.get(ctx.tenant, input);

    if (!covers(ctx.scope, statement.agencyId)) throw new TRPCError({ code: "NOT_FOUND" });

    return statement;
  },
  async document(ctx: Scoped, input: { id: string }) {
    await statementQueries.get(ctx, input);

    const file = await uc(ctx).statements.document(ctx.tenant, input);

    return { fileName: file.fileName, title: file.title, pdf: base64(file.body) };
  },
};

/** Agency statements and simulated billing events (PLAN §13). */
export const billingRouter = router({
  statements: router({
    list: statementRead
      .input(statementsInput)
      .query(({ ctx, input }) => statementQueries.list(ctx, input)),
    get: statementRead
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) => statementQueries.get(ctx, input)),
    document: statementRead
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) => statementQueries.document(ctx, input)),
  }),

  simulation: staffBilling.query(async ({ ctx }) => ({
    available: await uc(ctx).simulationAvailable(ctx.tenant),
  })),

  simulate: staffBilling.input(simulateInput).mutation(async ({ ctx, input }) => {
    if (!(await uc(ctx).simulationAvailable(ctx.tenant))) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "A billing system is connected; its events are the real ones",
      });
    }

    const result = await uc(ctx).applyEvent(ctx.tenant, {
      eventId: newId(),
      source: "simulation",
      type: input.type,
      occurredAt: ctx.container.clocks.forTenant(ctx.tenant.tenantId).now(),
      ...(input.invoiceId && { invoiceId: input.invoiceId }),
      ...(input.statementId && { statementId: input.statementId }),
      ...(input.amount && { amount: Money.of(input.amount.amount, input.amount.currency) }),
      reference: input.reference || "Simulated",
      ...(input.reason && { reason: input.reason }),
      provider: "Simulated billing system",
      actor: {
        type: "user",
        id: ctx.session.user.id,
        name: `${ctx.session.user.name} (simulation)`,
      },
    });

    return { applied: result.applied };
  }),
});

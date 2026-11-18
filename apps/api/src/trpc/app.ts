import type { SubmissionScope } from "@pas/submissions";
import { asId } from "@pas/kernel";
import { z } from "zod";
import { requireAppPermission } from "./app-tenant";
import { authedProcedure, publicProcedure, router } from "./init";
import {
  availableProductsInput,
  listSubmissionsInput,
  startSubmissionInput,
  submissionById,
  submissionData,
} from "./submissions-input";

const ownBook = (userId: string): SubmissionScope => ({
  kind: "producer",
  producerId: asId(userId),
});

/** app.pas.com: agents, brokers and customers. */
export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  me: authedProcedure.query(({ ctx }) => ({ user: ctx.session.user })),

  tenant: router({
    resolve: publicProcedure
      .input(z.object({ host: z.string().min(1).max(260), slug: z.string().max(63).nullish() }))
      .query(async ({ ctx, input }) => {
        const resolved = await ctx.container.useCases.tenants.resolveTenantByHost(input);

        return resolved.status === "tenant"
          ? { status: resolved.status, tenant: resolved.tenant }
          : resolved;
      }),
  }),

  submissions: router({
    availableProducts: requireAppPermission({ submission: ["create"] })
      .input(availableProductsInput)
      .query(({ ctx, input }) => {
        const { jurisdiction, effectiveDate } = input;

        return ctx.container.useCases.catalog.listAvailableProducts(ctx.tenant, {
          kind: "new_business",
          ...(jurisdiction && effectiveDate && { at: { jurisdiction, effectiveDate } }),
        });
      }),
    start: requireAppPermission({ submission: ["create"] })
      .input(startSubmissionInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.start(ctx.tenant, {
          ...input,
          producerName: ctx.session.user.name,
        }),
      ),
    get: requireAppPermission({ submission: ["read"] })
      .input(submissionById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.get(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    saveDraft: requireAppPermission({ submission: ["update"] })
      .input(submissionData)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.saveDraft(
          ctx.tenant,
          ownBook(ctx.session.user.id),
          input,
        ),
      ),
    submit: requireAppPermission({ submission: ["update"] })
      .input(submissionData)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.submit(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    list: requireAppPermission({ submission: ["read"] })
      .input(listSubmissionsInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.list(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
  }),
});

export type AppRouter = typeof appRouter;

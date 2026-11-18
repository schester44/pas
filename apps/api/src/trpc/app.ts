import type { PolicyScope } from "@pas/policy";
import type { SubmissionScope } from "@pas/submissions";
import { asId } from "@pas/kernel";
import { z } from "zod";
import { requireAppPermission } from "./app-tenant";
import { clientRouter } from "./client";
import { authedProcedure, publicProcedure, router } from "./init";
import {
  availableProductsInput,
  listSubmissionsInput,
  startSubmissionInput,
  submissionById,
  submissionData,
} from "./submissions-input";
import {
  bindDetailsInput,
  bindQuoteInput,
  bySubmission,
  customizeQuoteInput,
  listPoliciesInput,
  packetInput,
  policyById,
  policyDocument,
  signQuoteInput,
} from "./quotes-input";

const ownBook = (userId: string): SubmissionScope & PolicyScope => ({
  kind: "producer",
  producerId: asId(userId),
});

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

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

  client: clientRouter,

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

  quotes: router({
    get: requireAppPermission({ quote: ["read"] })
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.get.forProducer(
          ctx.tenant,
          ownBook(ctx.session.user.id),
          input,
        ),
      ),
    customize: requireAppPermission({ quote: ["read"], submission: ["update"] })
      .input(customizeQuoteInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.customize(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    saveDetails: requireAppPermission({ quote: ["bind"] })
      .input(bindDetailsInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.saveDetails(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    packet: requireAppPermission({ quote: ["read"] })
      .input(packetInput)
      .query(async ({ ctx, input }) => {
        const packet = await ctx.container.useCases.quotes.packet(
          ctx.tenant,
          ownBook(ctx.session.user.id),
          { submissionId: input.submissionId },
        );

        return { pdf: base64(packet.pdf), documents: packet.documents, revision: packet.revision };
      }),
    sign: requireAppPermission({ quote: ["bind"] })
      .input(signQuoteInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.sign(ctx.tenant, ownBook(ctx.session.user.id), {
          ...input,
          ...ctx.client,
        }),
      ),
    bind: requireAppPermission({ quote: ["bind"] })
      .input(bindQuoteInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.bind(ctx.tenant, ownBook(ctx.session.user.id), {
          submissionId: input.submissionId,
          method: { kind: "card", ...input.card },
          actorName: ctx.session.user.name,
        }),
      ),
  }),

  policies: router({
    list: requireAppPermission({ policy: ["read"] })
      .input(listPoliciesInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.list(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    get: requireAppPermission({ policy: ["read"] })
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.get.detail(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    billing: requireAppPermission({ policy: ["read"] })
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.billing(ctx.tenant, ownBook(ctx.session.user.id), input),
      ),
    document: requireAppPermission({ policy: ["read"] })
      .input(policyDocument)
      .query(async ({ ctx, input }) => {
        const file = await ctx.container.useCases.policies.get.document(
          ctx.tenant,
          ownBook(ctx.session.user.id),
          input,
        );

        return { fileName: file.fileName, title: file.title, pdf: base64(file.body) };
      }),
  }),
});

export type AppRouter = typeof appRouter;

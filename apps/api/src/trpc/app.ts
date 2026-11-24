import { fieldExtensionInput, recordActionInput, recordPanelInput } from "./extensions";
import { TRPCError } from "@trpc/server";
import { asId } from "@pas/kernel";
import { z } from "zod";
import { addressRouter } from "./addresses";
import { applyRouter } from "./apply";
import { statementQueries } from "./billing";
import { notificationsRouter } from "./events";
import { requireAppPermission, tenantFromHost } from "./app-tenant";
import { bookScopeOf } from "./book-scope";
import { clientRouter } from "./client";
import { policyChangesRouter, type ScopeResolver } from "./policy-changes";
import { authedProcedure, publicProcedure, router } from "./init";
import { appRecent, appSearch } from "./search";
import { producerUnderwritingRouter } from "./underwriting";
import {
  availableProductsInput,
  listSubmissionsInput,
  chooseOptionInput,
  startSubmissionInput,
  submissionById,
  submissionData,
} from "./submissions-input";
import {
  bindDetailsInput,
  bindQuoteInput,
  bySubmission,
  choosePayPlanInput,
  customizeQuoteInput,
  payPolicyInvoiceInput,
  setAutopayInput,
  listPoliciesInput,
  packetInput,
  enrichmentReportInput,
  policyById,
  policyDocument,
  signQuoteInput,
} from "./quotes-input";

/** RBAC against the host's tenant, then the caller's book there (PLAN §5.7). */
const inBook = (permissions: Parameters<typeof requireAppPermission>[0]) =>
  requireAppPermission(permissions).use(async ({ ctx, next }) =>
    next({ ctx: { ...ctx, scope: await bookScopeOf(ctx, ctx.tenant) } }),
  );

const agentScope: ScopeResolver = async (ctx) => {
  const tenant = await tenantFromHost(ctx);

  const allowed = await ctx.container.auth.api
    .hasPermission({
      headers: ctx.headers,
      body: { permissions: { policy: ["read"] }, organizationId: tenant.tenantId },
    })
    .then((result) => result.success)
    .catch(() => false);

  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

  return { tenant, scope: await bookScopeOf(ctx, tenant) };
};

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
    sandboxTime: publicProcedure
      .input(z.object({ host: z.string().min(1).max(260), slug: z.string().max(63).nullish() }))
      .query(async ({ ctx, input }) => {
        const resolved = await ctx.container.useCases.tenants.resolveTenantByHost(input);

        if (resolved.status !== "tenant" || !resolved.tenant.sandbox) return null;

        const environment = await ctx.container.useCases.tenants.environment({
          tenantId: asId(resolved.tenantId),
          actor: { type: "system", process: "app-sandbox-banner" },
        });

        return { now: environment.now };
      }),
  }),

  client: clientRouter,
  clientApplication: applyRouter,
  notifications: notificationsRouter(requireAppPermission({ submission: ["read"] })),

  addresses: addressRouter(tenantFromHost),

  submissions: router({
    availableOfferings: inBook({ submission: ["create"] })
      .input(availableProductsInput)
      .query(({ ctx, input }) => {
        const { jurisdiction, effectiveDate } = input;

        return ctx.container.useCases.catalog.listAvailableOfferings(ctx.tenant, {
          kind: "new_business",
          ...(jurisdiction && effectiveDate && { at: { jurisdiction, effectiveDate } }),
        });
      }),
    start: inBook({ submission: ["create"] })
      .input(startSubmissionInput)
      .mutation(async ({ ctx, input }) => {
        const record = await ctx.container.useCases.distribution.producerOfRecord(ctx.tenant, {
          userId: ctx.session.user.id,
        });

        return ctx.container.useCases.submissions.start(ctx.tenant, {
          ...input,
          producerName: record.name ?? ctx.session.user.name,
          producerAgencyId: record.agencyId,
        });
      }),
    get: inBook({ submission: ["read"] })
      .input(submissionById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.get(ctx.tenant, ctx.scope, input),
      ),
    fieldOptions: inBook({ submission: ["read"] })
      .input(fieldExtensionInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.fieldOptions(ctx.tenant, ctx.scope, input),
      ),
    fieldPrefill: inBook({ submission: ["read"] })
      .input(fieldExtensionInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.fieldPrefill(ctx.tenant, ctx.scope, input),
      ),
    extensionPanel: inBook({ submission: ["read"] })
      .input(recordPanelInput.extend({ submissionId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.panel(ctx.tenant, ctx.scope, input),
      ),
    extensionAction: inBook({ submission: ["update"] })
      .input(recordActionInput.extend({ submissionId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.action(ctx.tenant, ctx.scope, input),
      ),
    saveDraft: inBook({ submission: ["update"] })
      .input(submissionData)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.saveDraft(ctx.tenant, ctx.scope, input),
      ),
    submit: inBook({ submission: ["update"] })
      .input(submissionData)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.submit(ctx.tenant, ctx.scope, input),
      ),
    chooseOption: inBook({ submission: ["update"] })
      .input(chooseOptionInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.chooseOption(ctx.tenant, ctx.scope, input),
      ),
    clearance: inBook({ submission: ["read"] })
      .input(submissionById.extend({ riskData: z.record(z.string(), z.unknown()).optional() }))
      .query(async ({ ctx, input }) => {
        const result = await ctx.container.useCases.submissions.clearance(
          ctx.tenant,
          ctx.scope,
          input,
        );

        // Agents learn that a possible duplicate exists, not whose book it's in.
        return { mode: result.mode, outcome: result.outcome, count: result.conflicts.length };
      }),
    list: inBook({ submission: ["read"] })
      .input(listSubmissionsInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.list(ctx.tenant, ctx.scope, input),
      ),
  }),

  quotes: router({
    get: inBook({ quote: ["read"] })
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.get.forProducer(ctx.tenant, ctx.scope, input),
      ),
    customize: inBook({ quote: ["read"], submission: ["update"] })
      .input(customizeQuoteInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.customize(ctx.tenant, ctx.scope, input),
      ),
    choosePayPlan: inBook({ quote: ["bind"] })
      .input(choosePayPlanInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.choosePayPlan(ctx.tenant, ctx.scope, input),
      ),
    saveDetails: inBook({ quote: ["bind"] })
      .input(bindDetailsInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.saveDetails(ctx.tenant, ctx.scope, input),
      ),
    packet: inBook({ quote: ["read"] })
      .input(packetInput)
      .query(async ({ ctx, input }) => {
        const packet = await ctx.container.useCases.quotes.packet(ctx.tenant, ctx.scope, {
          submissionId: input.submissionId,
        });

        return { pdf: base64(packet.pdf), documents: packet.documents, revision: packet.revision };
      }),
    enrichment: inBook({ quote: ["read"] })
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.enrichment.view(ctx.tenant, ctx.scope, input),
      ),
    enrichmentReport: inBook({ quote: ["read"] })
      .input(enrichmentReportInput)
      .query(async ({ ctx, input }) => {
        const file = await ctx.container.useCases.quotes.enrichment.report(
          ctx.tenant,
          ctx.scope,
          input,
        );

        return { title: file.title, pdf: base64(file.body) };
      }),
    sign: inBook({ quote: ["bind"] })
      .input(signQuoteInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.sign(ctx.tenant, ctx.scope, {
          ...input,
          ...ctx.client,
          signer: { party: "producer", userId: ctx.session.user.id, email: ctx.session.user.email },
        }),
      ),
    billingOptions: inBook({ quote: ["bind"] })
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.billingOptions(ctx.tenant, ctx.scope, input),
      ),
    completion: inBook({ quote: ["read"] })
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.completion(ctx.tenant, ctx.scope, input),
      ),
    sendToClient: inBook({ quote: ["bind"] })
      .input(
        bySubmission.extend({
          email: z.email().max(254),
          name: z.string().trim().min(1).max(200),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const sent = await ctx.container.useCases.quotes.sendToClient(ctx.tenant, ctx.scope, {
          ...input,
          actorName: ctx.session.user.name,
        });

        return {
          request: sent.request,
          url: await ctx.container.useCases.clientLinkUrl(ctx.tenant, sent.requestId),
        };
      }),
    checkout: inBook({ quote: ["bind"] }).query(async ({ ctx }) =>
      ctx.container.useCases.quotes.checkout(ctx.tenant),
    ),
    bind: inBook({ quote: ["bind"] })
      .input(bindQuoteInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.bind(ctx.tenant, ctx.scope, {
          submissionId: input.submissionId,
          ...(input.billingMethod && { billingMethod: input.billingMethod }),
          ...(input.paymentToken
            ? { method: { kind: "token" as const, token: input.paymentToken } }
            : input.card
              ? { method: { kind: "card" as const, ...input.card } }
              : {}),
          actorName: ctx.session.user.name,
          autopay: input.autopay ?? false,
          payer: "producer",
        }),
      ),
  }),

  search: router({ query: appSearch, ...appRecent }),

  actionItems: inBook({ submission: ["read"], policy: ["read"] }).query(({ ctx }) =>
    ctx.container.useCases.actionItems(ctx.tenant, ctx.scope),
  ),

  underwriting: producerUnderwritingRouter,

  agency: router({
    mine: inBook({ agency: ["read"] }).query(({ ctx }) =>
      ctx.scope.kind === "agencies"
        ? ctx.container.useCases.distribution.agencies.list(ctx.tenant, ctx.scope)
        : [],
    ),
    get: inBook({ agency: ["read"] })
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.distribution.agencies.get(ctx.tenant, ctx.scope, input),
      ),
    statements: inBook({ agency: ["read"] })
      .input(statementQueries.input)
      .query(({ ctx, input }) => statementQueries.list(ctx, input)),
    statement: inBook({ agency: ["read"] })
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) => statementQueries.get(ctx, input)),
    statementDocument: inBook({ agency: ["read"] })
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) => statementQueries.document(ctx, input)),
  }),

  quoteLicensing: inBook({ quote: ["read"] })
    .input(bySubmission)
    .query(async ({ ctx, input }) => {
      const submission = await ctx.container.useCases.submissions.get(ctx.tenant, ctx.scope, {
        id: input.submissionId,
      });

      const result = await ctx.container.useCases.distribution.checkLicense(ctx.tenant, {
        userId: submission.producer.id,
        productId: submission.productId,
        jurisdiction: submission.jurisdiction,
        effectiveDate: submission.effectiveDate,
      });

      return { mode: result.mode, blocks: result.blocks, message: result.message };
    }),

  policies: router({
    list: inBook({ policy: ["read"] })
      .input(listPoliciesInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.list(ctx.tenant, ctx.scope, input),
      ),
    get: inBook({ policy: ["read"] })
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, input),
      ),
    extensionSurfaces: inBook({ policy: ["read"] })
      .input(z.object({ policyId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.extensions.surfaces(ctx.tenant, ctx.scope, input),
      ),
    extensionPanel: inBook({ policy: ["read"] })
      .input(recordPanelInput.extend({ policyId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.extensions.panel(ctx.tenant, ctx.scope, input),
      ),
    extensionAction: inBook({ policy: ["update"] })
      .input(recordActionInput.extend({ policyId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.policies.extensions.action(ctx.tenant, ctx.scope, input),
      ),
    carrier: inBook({ policy: ["read"] })
      .input(policyById)
      .query(async ({ ctx, input }) => {
        await ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, input);

        return ctx.container.carriers.services.policyLink(ctx.tenant, { policyId: input.id });
      }),
    billing: inBook({ policy: ["read"] })
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.billing(ctx.tenant, ctx.scope, input),
      ),
    payInvoice: inBook({ policy: ["read"] })
      .input(payPolicyInvoiceInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.policies.payInvoice(ctx.tenant, ctx.scope, {
          policyId: input.policyId,
          invoiceId: input.invoiceId,
          card: { kind: "card", ...input.card },
          actor: { type: "user", id: ctx.session.user.id, name: ctx.session.user.name },
        }),
      ),
    setAutopay: inBook({ policy: ["read"] })
      .input(setAutopayInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.policies.setAutopay(ctx.tenant, ctx.scope, {
          policyId: input.policyId,
          enabled: input.enabled,
          ...(input.card && { method: { kind: "card" as const, ...input.card } }),
          payerName: input.card?.name ?? "",
          actor: { type: "user", id: ctx.session.user.id, name: ctx.session.user.name },
        }),
      ),
    document: inBook({ policy: ["read"] })
      .input(policyDocument)
      .query(async ({ ctx, input }) => {
        const file = await ctx.container.useCases.policies.get.document(
          ctx.tenant,
          ctx.scope,
          input,
        );

        return { fileName: file.fileName, title: file.title, pdf: base64(file.body) };
      }),
    changes: policyChangesRouter(agentScope),
  }),
});

export type AppRouter = typeof appRouter;

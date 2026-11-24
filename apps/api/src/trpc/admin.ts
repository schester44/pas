import { SELECTION_STRATEGIES } from "@pas/catalog";
import { riskSchemaSchema } from "@pas/forms-core";
import type { PolicyScope } from "@pas/policy";
import type { SubmissionScope } from "@pas/submissions";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  byId,
  byProduct,
  ratingConfigInput,
  ratingInput,
  raterSourceInput,
  resolveReleaseInput,
  updateVersionInput,
  versionLabel,
} from "./catalog-input";
import {
  assertPermission,
  authedProcedure,
  requirePermission,
  router,
  tenantProcedure,
} from "./init";
import {
  bySubmission,
  enrichmentReportInput,
  decideReferralInput,
  listPoliciesInput,
  payPolicyInvoiceInput,
  policyById,
  policyDocument,
  setAutopayInput,
} from "./quotes-input";
import { listSubmissionsInput, submissionById } from "./submissions-input";
import { policyChangesRouter, staffScope } from "./policy-changes";
import { addressRouter } from "./addresses";
import { complianceRouter } from "./compliance";
import { underwritingRouter } from "./underwriting";
import { eventsRouter, notificationsRouter } from "./events";
import { integrationsRouter } from "./integrations";
import { carriersRouter } from "./carriers";
import {
  extensionsRouter,
  fieldExtensionInput,
  recordActionInput,
  recordPanelInput,
} from "./extensions";
import { adminRecent, adminSearch } from "./search";
import { bookScopeOf } from "./book-scope";
import { billingRouter } from "./billing";
import { ledgerRouter } from "./ledger";
import { distributionRouter } from "./distribution";
import { agencyDownloadsRouter } from "./agency-downloads";
import { workflowsRouter } from "./workflows";

const submissionRead = requirePermission({ submission: ["read"] }).use(async ({ ctx, next }) => {
  const scope: SubmissionScope = await bookScopeOf(ctx, ctx.tenant);

  return next({ ctx: { ...ctx, scope } });
});

const policyRead = requirePermission({ policy: ["read"] }).use(async ({ ctx, next }) => {
  const scope: PolicyScope = await bookScopeOf(ctx, ctx.tenant);

  return next({ ctx: { ...ctx, scope } });
});

const policyBilling = requirePermission({ policy: ["read", "update"] }).use(
  async ({ ctx, next }) => {
    const scope: PolicyScope = await bookScopeOf(ctx, ctx.tenant);

    return next({ ctx: { ...ctx, scope } });
  },
);

const clientsAdmin = policyRead.use(({ ctx, next }) => {
  if (ctx.scope.kind !== "tenant") throw new TRPCError({ code: "FORBIDDEN" });

  return next();
});

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const offeringInput = z.object({
  name: z.string().min(1).max(200),
  productIds: z.array(z.uuid()).min(1).max(50),
  selection: z.enum(SELECTION_STRATEGIES),
});

/** admin.pas.com: tenant staff (configuration + operations). */
export const adminRouter = router({
  me: authedProcedure.query(({ ctx }) => ({
    user: ctx.session.user,
    activeOrganizationId: ctx.session.session.activeOrganizationId ?? null,
  })),

  catalog: router({
    products: router({
      list: requirePermission({ product: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.catalog.listProducts(ctx.tenant),
      ),
      create: requirePermission({ product: ["write"] })
        .input(
          z.object({
            key: z.string().min(2).max(63),
            name: z.string().min(1).max(200),
            lineOfBusiness: z.string().min(1).max(100),
          }),
        )
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.createProduct(ctx.tenant, input),
        ),
      get: requirePermission({ product: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.getProduct(ctx.tenant, input)),
    }),

    offerings: router({
      list: requirePermission({ product: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.catalog.listOfferings(ctx.tenant),
      ),
      create: requirePermission({ product: ["write"] })
        .input(offeringInput.extend({ key: z.string().min(2).max(63) }))
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.createOffering(ctx.tenant, input),
        ),
      update: requirePermission({ product: ["write"] })
        .input(offeringInput.extend({ id: z.uuid(), active: z.boolean() }))
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.updateOffering(ctx.tenant, input),
        ),
    }),

    versions: router({
      list: requirePermission({ product: ["read"] })
        .input(byProduct)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.listVersions(ctx.tenant, input)),
      get: requirePermission({ product: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.getVersion(ctx.tenant, input)),
      dataProviders: requirePermission({ product: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.catalog.dataProviders(ctx.tenant),
      ),
      check: requirePermission({ product: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.checkVersion(ctx.tenant, input)),
      create: requirePermission({ product: ["write"] })
        .input(byProduct.extend({ version: versionLabel }))
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.createVersion(ctx.tenant, input),
        ),
      copy: requirePermission({ product: ["write"] })
        .input(byId.extend({ version: versionLabel }))
        .mutation(async ({ ctx, input }) => {
          const source = await ctx.container.useCases.catalog.getVersion(ctx.tenant, input);

          return ctx.container.useCases.catalog.createVersion(ctx.tenant, {
            productId: source.productId,
            version: input.version,
            copyFromId: input.id,
          });
        }),
      update: tenantProcedure.input(updateVersionInput).mutation(async ({ ctx, input }) => {
        const { id: _, documents, rules, rating, ...product } = input;

        if (documents) await assertPermission(ctx, { document: ["write"] });

        if (rules) await assertPermission(ctx, { decision: ["write"] });

        if (rating !== undefined) await assertPermission(ctx, { rating: ["write"] });

        if (Object.keys(product).length > 0 || (!documents && !rules && rating === undefined)) {
          await assertPermission(ctx, { product: ["write"] });
        }

        return ctx.container.useCases.catalog.updateVersion(ctx.tenant, input);
      }),
      submitForReview: requirePermission({ product: ["write"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.submitVersion(ctx.tenant, input),
        ),
      returnToDraft: requirePermission({ product: ["write"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.reopenVersion(ctx.tenant, input),
        ),
      publish: requirePermission({ product: ["publish"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.publishVersion(ctx.tenant, input),
        ),
      retire: requirePermission({ product: ["publish"] })
        .input(byId)
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.catalog.retireVersion(ctx.tenant, input),
        ),
    }),

    releases: router({
      list: requirePermission({ product: ["read"] })
        .input(byProduct)
        .query(({ ctx, input }) => ctx.container.useCases.catalog.listReleases(ctx.tenant, input)),
      resolve: requirePermission({ product: ["read"] })
        .input(resolveReleaseInput)
        .query(({ ctx, input }) =>
          ctx.container.useCases.catalog.resolveRelease(ctx.tenant, input),
        ),
    }),
  }),

  rating: router({
    workbooks: router({
      list: requirePermission({ rating: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.rating.listWorkbooks(ctx.tenant),
      ),
      get: requirePermission({ rating: ["read"] })
        .input(byId)
        .query(({ ctx, input }) => ctx.container.useCases.rating.getWorkbook(ctx.tenant, input)),
    }),
    check: requirePermission({ rating: ["read"] })
      .input(
        z.object({
          rating: ratingConfigInput.nullable(),
          riskSchema: riskSchemaSchema,
          coverageCodes: z.array(z.string().max(64)).max(500),
        }),
      )
      .mutation(({ ctx, input }) => ctx.container.useCases.rating.check(ctx.tenant, input)),
    preview: requirePermission({ rating: ["read"] })
      .input(z.object({ rating: raterSourceInput, input: ratingInput }))
      .mutation(({ ctx, input }) => ctx.container.useCases.rating.preview(ctx.tenant, input)),
  }),

  documents: router({
    formEditions: router({
      list: requirePermission({ document: ["read"] }).query(({ ctx }) =>
        ctx.container.useCases.formLibrary.list(ctx.tenant),
      ),
    }),
  }),

  submissions: router({
    list: submissionRead
      .input(listSubmissionsInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.list(ctx.tenant, ctx.scope, input),
      ),
    get: submissionRead
      .input(submissionById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.get(ctx.tenant, ctx.scope, input),
      ),
    clearance: submissionRead
      .input(submissionById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.clearance(ctx.tenant, ctx.scope, input),
      ),
    fieldOptions: submissionRead
      .input(fieldExtensionInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.fieldOptions(ctx.tenant, ctx.scope, input),
      ),
    fieldPrefill: submissionRead
      .input(fieldExtensionInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.fieldPrefill(ctx.tenant, ctx.scope, input),
      ),
    extensionPanel: submissionRead
      .input(recordPanelInput.extend({ submissionId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.submissions.panel(ctx.tenant, ctx.scope, input),
      ),
    extensionAction: submissionRead
      .use(async ({ ctx, next }) => {
        await assertPermission(ctx, { submission: ["update"] });

        return next();
      })
      .input(recordActionInput.extend({ submissionId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.submissions.action(ctx.tenant, ctx.scope, input),
      ),
    quote: submissionRead
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.get.forStaff(ctx.tenant, ctx.scope, input),
      ),
    quoteEnrichment: submissionRead
      .input(bySubmission)
      .query(({ ctx, input }) =>
        ctx.container.useCases.quotes.enrichment.view(ctx.tenant, ctx.scope, input),
      ),
    enrichmentReport: submissionRead.input(enrichmentReportInput).query(async ({ ctx, input }) => {
      const file = await ctx.container.useCases.quotes.enrichment.report(
        ctx.tenant,
        ctx.scope,
        input,
      );

      return { title: file.title, pdf: base64(file.body) };
    }),
    decideReferral: submissionRead
      .use(async ({ ctx, next }) => {
        await assertPermission(ctx, { uw: ["approve"] });

        return next();
      })
      .input(decideReferralInput)
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.quotes.decideReferral(ctx.tenant, ctx.scope, {
          ...input,
          underwriterName: ctx.session.user.name,
        }),
      ),
  }),

  policies: router({
    list: policyRead
      .input(listPoliciesInput)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.list(ctx.tenant, ctx.scope, input),
      ),
    get: policyRead
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, input),
      ),
    extensionSurfaces: policyRead
      .input(z.object({ policyId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.extensions.surfaces(ctx.tenant, ctx.scope, input),
      ),
    extensionPanel: policyRead
      .input(recordPanelInput.extend({ policyId: z.uuid() }))
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.extensions.panel(ctx.tenant, ctx.scope, input),
      ),
    extensionAction: policyRead
      .use(async ({ ctx, next }) => {
        await assertPermission(ctx, { policy: ["update"] });

        return next();
      })
      .input(recordActionInput.extend({ policyId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.policies.extensions.action(ctx.tenant, ctx.scope, input),
      ),
    risk: policyRead
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.risk(ctx.tenant, ctx.scope, { policyId: input.id }),
      ),
    billing: policyRead
      .input(policyById)
      .query(({ ctx, input }) =>
        ctx.container.useCases.policies.billing(ctx.tenant, ctx.scope, input),
      ),
    payInvoice: policyBilling.input(payPolicyInvoiceInput).mutation(({ ctx, input }) =>
      ctx.container.useCases.policies.payInvoice(ctx.tenant, ctx.scope, {
        policyId: input.policyId,
        invoiceId: input.invoiceId,
        card: { kind: "card", ...input.card },
        actor: { type: "user", id: ctx.session.user.id, name: ctx.session.user.name },
      }),
    ),
    setAutopay: policyBilling.input(setAutopayInput).mutation(({ ctx, input }) =>
      ctx.container.useCases.policies.setAutopay(ctx.tenant, ctx.scope, {
        policyId: input.policyId,
        enabled: input.enabled,
        ...(input.card && { method: { kind: "card" as const, ...input.card } }),
        payerName: input.card?.name ?? "",
        actor: { type: "user", id: ctx.session.user.id, name: ctx.session.user.name },
      }),
    ),
    clients: policyRead.input(policyById).query(async ({ ctx, input }) => {
      await ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, input);

      return ctx.container.useCases.parties.policyClients(ctx.tenant, { policyId: input.id });
    }),
    resendInvite: policyRead
      .input(z.object({ policyId: z.uuid(), clientAccountId: z.uuid() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.container.useCases.policies.get.detail(ctx.tenant, ctx.scope, {
          id: input.policyId,
        });

        return ctx.container.useCases.parties.resendInvite(ctx.tenant, input);
      }),
    changeRequests: policyRead.input(policyById).query(({ ctx, input }) =>
      ctx.container.useCases.policies.changeRequests(ctx.tenant, ctx.scope, {
        policyId: input.id,
      }),
    ),
    document: policyRead.input(policyDocument).query(async ({ ctx, input }) => {
      const file = await ctx.container.useCases.policies.get.document(ctx.tenant, ctx.scope, input);

      return { fileName: file.fileName, title: file.title, pdf: base64(file.body) };
    }),
    switchToDirect: policyBilling
      .input(z.object({ policyId: z.uuid() }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.policies.switchToDirect(ctx.tenant, ctx.scope, {
          policyId: input.policyId,
          actor: { type: "user", id: ctx.session.user.id, name: ctx.session.user.name },
        }),
      ),
    changes: policyChangesRouter(staffScope),
  }),

  search: router({ query: adminSearch, ...adminRecent }),
  addresses: addressRouter(async (ctx) => (await staffScope(ctx)).tenant),

  integrations: integrationsRouter,
  carriers: carriersRouter(staffScope),
  extensions: extensionsRouter,
  events: eventsRouter,
  workflows: workflowsRouter,
  notifications: notificationsRouter(tenantProcedure),

  compliance: complianceRouter,
  underwriting: underwritingRouter,

  distribution: distributionRouter,
  agencyDownloads: agencyDownloadsRouter,
  billing: billingRouter,
  ledger: ledgerRouter,

  clients: router({
    get: clientsAdmin
      .input(z.object({ id: z.uuid() }))
      .query(({ ctx, input }) => ctx.container.useCases.clientDetail(ctx.tenant, ctx.scope, input)),
    list: clientsAdmin
      .input(z.object({ query: z.string().trim().max(200).optional() }).optional())
      .query(({ ctx, input }) =>
        ctx.container.useCases.parties.search(ctx.tenant, { query: input?.query }),
      ),
    merge: clientsAdmin
      .use(async ({ ctx, next }) => {
        await assertPermission(ctx, { policy: ["update"] });

        return next();
      })
      .input(z.object({ survivorId: z.uuid(), mergedId: z.uuid() }))
      .mutation(({ ctx, input }) => ctx.container.useCases.parties.merge(ctx.tenant, input)),
  }),

  tenant: router({
    profile: router({
      get: tenantProcedure.query(({ ctx }) =>
        ctx.container.useCases.tenants.getProfile(ctx.tenant),
      ),
      update: requirePermission({ organization: ["update"] })
        .input(
          z.object({
            displayName: z.string().max(120),
            primaryColor: z.string().max(7),
            logoUrl: z.string().max(2000).nullable(),
            appSubdomain: z.string().max(63),
            customDomains: z.array(z.string().max(253)).max(10),
            supportEmail: z.string().max(254).nullable(),
            supportPhone: z.string().max(40).nullable(),
          }),
        )
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.tenants.updateProfile(ctx.tenant, input),
        ),
    }),
    environment: tenantProcedure.query(({ ctx }) =>
      ctx.container.useCases.tenants.environment(ctx.tenant),
    ),
    createSandbox: requirePermission({ organization: ["update"] })
      .input(z.object({ name: z.string().max(120) }))
      .mutation(({ ctx, input }) =>
        ctx.container.useCases.tenants.createSandbox(ctx.tenant, input),
      ),
    time: router({
      preview: requirePermission({ organization: ["update"] })
        .input(z.object({ to: z.iso.datetime({ offset: true }).nullable() }))
        .query(({ ctx, input }) =>
          ctx.container.useCases.tenants.sandboxTime.preview(ctx.tenant, {
            to: input.to ? Temporal.Instant.from(input.to) : null,
          }),
        ),
      history: requirePermission({ organization: ["update"] }).query(({ ctx }) =>
        ctx.container.useCases.tenants.sandboxTime.history(ctx.tenant),
      ),
      advance: requirePermission({ organization: ["update"] })
        .input(z.object({ to: z.iso.datetime({ offset: true }) }))
        .mutation(({ ctx, input }) =>
          ctx.container.useCases.tenants.sandboxTime.advance(ctx.tenant, {
            to: Temporal.Instant.from(input.to),
          }),
        ),
    }),
  }),
});

export type AdminRouter = typeof adminRouter;

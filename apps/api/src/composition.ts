import { createAuth, eventAudience } from "@pas/auth";
import {
  makeCheckProductVersion,
  makeCreateProduct,
  makeCreateProductVersion,
  makeGetProduct,
  makeGetProductRelease,
  makeGetProductVersion,
  makeListAvailableProducts,
  makeListProductReleases,
  makeListProducts,
  makeListProductVersions,
  makePublishProductVersion,
  makeResolveRelease,
  makeRetireProductVersion,
  makeReturnProductVersionToDraft,
  makeSubmitProductVersion,
  makeUpdateProductVersion,
} from "@pas/catalog";
import {
  PrismaCatalogCloner,
  PrismaProductReleaseRepository,
  PrismaProductRepository,
  PrismaProductVersionRepository,
} from "@pas/catalog/infrastructure";
import { composeAgencyDownloads } from "@pas/agency-downloads/infrastructure";
import { composeCompliance } from "@pas/compliance/infrastructure";
import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
import {
  makeFindExistingFormEditions,
  makeGetFormEditionFile,
  makeListFormEditions,
  makeUploadFormEdition,
} from "@pas/form-library";
import {
  PdfLibInspector,
  PrismaFormEditionCloner,
  PrismaFormEditionRepository,
} from "@pas/form-library/infrastructure";
import { asId, sameJurisdiction, type TenantContext } from "@pas/kernel";
import {
  makeApplyBillingEvent,
  makeApplyPayment,
  makeEnrollAutopay,
  makeGetPolicyBilling,
  makeIssueInvoice,
  makeListInvoices,
  makePayInvoice,
  makeInstallmentTimers,
  makeSetAutopay,
  pastDueOf,
} from "@pas/billing";
import {
  PrismaAgencyStatementRepository,
  PrismaBillingEventLog,
  PrismaBillingScheduleRepository,
  PrismaInvoiceRepository,
  PrismaMortgageeBillRepository,
} from "@pas/billing/infrastructure";
import {
  makeAttachPolicyDocuments,
  makeCancellationReasons,
  makeChangeProducer,
  makeDiscardTransaction,
  makeGetEndorsementSetup,
  makeGetPolicyRisk,
  makeGetPolicy,
  makePolicyExtensions,
  makeGetTransactionFacts,
  makeGetTransactionFinancials,
  makeInitiateCancellation,
  makeIssueNewBusiness,
  makeIssueTransaction,
  makeListChangeRequests,
  makeListPolicies,
  makeQuoteCancellation,
  makeQuoteEndorsement,
  makeQuoteReinstatement,
  makeRecordPolicyEvent,
  makeTermTimers,
  makeReinstatePolicy,
  makeRequestPolicyChange,
  makeRescindCancellation,
  makeCureNonpayment,
  type PolicyProductConfig,
  type PolicyRelease,
  type PolicyScope,
  type TermRater,
} from "@pas/policy";
import {
  PrismaChangeRequestRepository,
  PortNoticeDelivery,
  PrismaPolicyRepository,
  ReactPdfNoticeDocuments,
} from "@pas/policy/infrastructure";
import {
  type BillingDirectory,
  makeClaimClientPolicy,
  makeClientInvoices,
  makeGetClientPolicy,
  makeGetClientProfile,
  makeGetClientAccount,
  makeGetPolicyClients,
  makeLinkPolicyInsureds,
  makeListClientPolicies,
  makeMergeClientAccounts,
  makeRequestPolicyChange as makeRequestClientChange,
  makeResendPortalInvite,
  makeResolveClientScope,
  makeSearchClientAccounts,
} from "@pas/parties";
import {
  ConsoleMailer,
  PrismaClientAccountRepository,
  PrismaClientUserRepository,
  PrismaPolicyPartyRepository,
  PrismaProducerDirectory,
} from "@pas/parties/infrastructure";
import {
  makeCheckRating,
  makeGetRaterWorkbook,
  makeListRaterWorkbooks,
  makePreviewRating,
  makeRateRisk,
  makeUploadRaterWorkbook,
  makeWorkbookModels,
} from "@pas/rating";
import {
  PrismaRaterWorkbookCloner,
  PrismaRaterWorkbookRepository,
} from "@pas/rating/infrastructure";
import { composeAddresses } from "@pas/addresses/infrastructure";
import { composeEvents } from "@pas/events/infrastructure";
import {
  AesSecretBox,
  builtinProviders,
  composeIntegrations,
  agencyDownloadChannelsFrom,
  filingChannelsFrom,
  inspectionProviders,
  licensingProviders,
} from "@pas/integrations/infrastructure";
import {
  makeAgencyBilling,
  makeCommissionFacts,
  makeAgencyStatement,
  makeCheckProducerLicense,
  makeManageAgencies,
  makeManageProducers,
  makeManageRules,
  makeProducerOfRecord,
  makeResolveBookScope,
} from "@pas/distribution";
import {
  OnFileLicensing,
  PrismaDistributionCloner,
  PrismaAgencyRepository,
  PrismaCommissionRepository,
  PrismaMemberDirectory,
  PrismaProducerRepository,
} from "@pas/distribution/infrastructure";
import { makeRecentViews, makeSearch } from "@pas/search";
import { PostgresSearchIndex, PrismaRecentViews } from "@pas/search/infrastructure";
import {
  AppHosts,
  makeGetProfile,
  makeCreateSandbox,
  makeGetEnvironment,
  makeListTenants,
  makeResolveTenantByHost,
  makeSandboxTime,
  makeUpdateProfile,
} from "@pas/tenants";
import {
  PrismaSandboxOrganizations,
  PrismaTenantDirectory,
  PrismaTenantEnvironmentRepository,
  PrismaTenantProfileRepository,
  TenantClocks,
} from "@pas/tenants/infrastructure";
import {
  makeBillingOptions,
  makeBindQuote,
  makeCheckSubmissionClearance,
  makeChoosePayPlan,
  makeCustomizeQuote,
  makeDecideReferral,
  makeGetQuote,
  makePreviewReferralApproval,
  makeRecordQuoteActivity,
  makeRateTerm,
  makeGetSubmission,
  makeListSubmissions,
  makeRenderQuotePacket,
  makeSaveBindDetails,
  makeSaveDraft,
  makeFieldOptions,
  makeFieldPrefill,
  makeRunSubmissionAction,
  makeSubmissionPanel,
  makeSignQuote,
  makeQuoteTimers,
  makeRequestCarrierQuote,
  makeStartSubmission,
  makeSubmitSubmission,
  QuoteJourney,
  clientApplicationPath,
  makeClientApplication,
  makeGetClientCompletion,
  makeSendToClient,
  makeGetQuoteEnrichment,
} from "@pas/submissions";
import {
  CatalogProductCatalog,
  ClickToSignGateway,
  FakeCardGateway,
  composeRiskEnricher,
  PrismaQuoteRepository,
  PrismaSubmissionRepository,
  RatingModuleQuoteRater,
  ReactPdfQuoteDocuments,
  HmacClientLinks,
  PrismaClientRequestRepository,
} from "@pas/submissions/infrastructure";
import { createLogger } from "@pas/observability";
import { PgBossOutbox, QueueClient, queueConnectionFromEnv } from "@pas/queues";
import { createStorageFromEnv } from "@pas/storage";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { composeEnrichmentExtensions } from "./enrichment";
import { PostgresWorkflows, workflowConnectionFromEnv } from "@pas/workflows";
import {
  composeUnderwriting,
  PrismaUnderwritingSettingsCloner,
  SubmissionsQuoteDesk,
} from "@pas/underwriting/infrastructure";
import { composeApiBillingMethods } from "./billing-methods";
import { composeApiCarriers, mockCarrier } from "./carriers";
import { PrismaCarrierCloner } from "@pas/carriers/infrastructure";
import {
  composeExtensions,
  PrismaExtensionCloner,
  sandboxSettingsFromEnv,
} from "@pas/extensions/infrastructure";
import { composeApiLedger } from "./ledger";
import { env } from "./env";
import { sandboxAccess } from "./sandbox-access";
import { makeRunDescriber, makeSandboxTimers, type RunDescriberDeps } from "./sandbox-timers";
import { makeWorkflowRuns } from "./workflow-runs";
import { makeActionItems } from "./action-items";
import { makeClientDetail } from "./client-detail";

const party = (policyIds: readonly string[]) => ({ kind: "party" as const, policyIds });

export function compose() {
  const logger = createLogger("api");
  const prisma = getPrismaClient();
  const queues = new QueueClient(queueConnectionFromEnv(), logger);

  const uow = new PrismaUnitOfWork(prisma);
  const outbox = new PgBossOutbox(queues);
  const clocks = new TenantClocks(prisma);

  const products = new PrismaProductRepository();
  const versions = new PrismaProductVersionRepository();
  const releases = new PrismaProductReleaseRepository();
  const tenantProfiles = new PrismaTenantProfileRepository();
  const tenantDirectory = new PrismaTenantDirectory(prisma);
  const appHosts = new AppHosts(env.APP_ORIGIN);
  const submissions = new PrismaSubmissionRepository();
  const storage = createStorageFromEnv();
  const formEditions = new PrismaFormEditionRepository();

  const formLibrary = {
    upload: makeUploadFormEdition({
      uow,
      outbox,
      editions: formEditions,
      storage,
      pdf: new PdfLibInspector(),
      clocks,
    }),
    list: makeListFormEditions({ uow, editions: formEditions }),
    getFile: makeGetFormEditionFile({ uow, editions: formEditions, storage }),
    findExisting: makeFindExistingFormEditions({ uow, editions: formEditions }),
  };

  const formEditionDirectory = { existing: formLibrary.findExisting };

  const extensions = composeExtensions({
    uow,
    outbox,
    clocks,
    secretBox: new AesSecretBox(process.env.INTEGRATIONS_SECRET_KEY),
    isSandbox: async (ctx) => {
      await clocks.refresh(ctx.tenantId);

      return clocks.isSandbox(ctx.tenantId);
    },
    ...sandboxSettingsFromEnv(),
  });

  const raterWorkbooks = new PrismaRaterWorkbookRepository();
  const workbookModels = makeWorkbookModels({ uow, workbooks: raterWorkbooks, storage });

  const rating = {
    uploadWorkbook: makeUploadRaterWorkbook({
      uow,
      outbox,
      workbooks: raterWorkbooks,
      storage,
      clocks,
    }),
    listWorkbooks: makeListRaterWorkbooks({ uow, workbooks: raterWorkbooks }),
    getWorkbook: makeGetRaterWorkbook({ models: workbookModels }),
    check: makeCheckRating({ models: workbookModels, extensions: extensions.rater }),
    preview: makePreviewRating({ models: workbookModels, extensions: extensions.rater }),
  };

  const ratingVerifier = {
    verify: async (...args: Parameters<typeof rating.check>) =>
      (await rating.check(...args)).issues,
  };

  const catalog = {
    listProducts: makeListProducts({ uow, products }),
    getProduct: makeGetProduct({ uow, products }),
    getRelease: makeGetProductRelease({ uow, releases }),
    resolveRelease: makeResolveRelease({ uow, products, releases }),
  };

  const productCatalog = new CatalogProductCatalog(catalog);
  const getProfile = makeGetProfile({ uow, profiles: tenantProfiles, hosts: appHosts });

  // The API only starts and signals runs; the worker executes them.
  const workflows = new PostgresWorkflows({
    ...workflowConnectionFromEnv(),
    logger,
    tenantTime: clocks,
  });

  const journey = new QuoteJourney(workflows, (ctx, quote) => requestCarrierQuote(ctx, quote));
  const quotes = new PrismaQuoteRepository();
  const policies = new PrismaPolicyRepository();

  const invoices = new PrismaInvoiceRepository();
  const schedules = new PrismaBillingScheduleRepository();
  const recordPolicyEvent = makeRecordPolicyEvent({ policies, clocks, outbox });

  const mortgageeBills = new PrismaMortgageeBillRepository();

  const billingEvents = {
    invoices,
    events: new PrismaBillingEventLog(),
    timeline: { record: recordPolicyEvent },
    outbox,
    clocks,
    statements: new PrismaAgencyStatementRepository(),
    mortgageeBills,
  };

  const applyBillingEvent = makeApplyBillingEvent({ ...billingEvents, uow });
  const issueInvoice = makeIssueInvoice({ ...billingEvents, schedules, mortgageeBills });

  const getPolicyBilling = makeGetPolicyBilling({
    uow,
    invoices,
    schedules,
    statements: billingEvents.statements,
    mortgageeBills,
    clocks,
  });

  const enrollAutopay = makeEnrollAutopay({
    uow,
    schedules,
    applyEvent: applyBillingEvent,
    clocks,
  });

  const clientAccounts = new PrismaClientAccountRepository();
  const policyParties = new PrismaPolicyPartyRepository();
  const clientUsers = new PrismaClientUserRepository();
  const changeRequests = new PrismaChangeRequestRepository();

  const linkPolicyInsureds = makeLinkPolicyInsureds({
    accounts: clientAccounts,
    parties: policyParties,
    outbox,
    clocks,
  });

  const mailer = new ConsoleMailer(logger);

  const distributionDeps = {
    uow,
    agencies: new PrismaAgencyRepository(),
    producers: new PrismaProducerRepository(),
    commissions: new PrismaCommissionRepository(),
    clocks,
  };

  const integrations = composeIntegrations({
    prisma,
    uow,
    outbox,
    clocks,
    environments: {
      isSandbox: async (tenantId) => {
        await clocks.refresh(tenantId);

        return clocks.isSandbox(tenantId);
      },
    },
    builtins: [
      ...builtinProviders({
        payments: new FakeCardGateway(clocks),
        esign: new ClickToSignGateway(),
        email: mailer,
      }),
      ...licensingProviders(new OnFileLicensing(distributionDeps)),
      ...inspectionProviders(clocks),
    ],
    notices: {
      record: (tx, ctx, input) =>
        recordPolicyEvent(tx, ctx, {
          ...input,
          type: "notice_mailed",
          actor: { type: "system", name: "Print and mail" },
        }),
    },
    secretKey: process.env.INTEGRATIONS_SECRET_KEY,
    publicUrl: env.BETTER_AUTH_URL,
  });

  const events = composeEvents({
    prisma,
    uow,
    outbox,
    clocks,
    queues,
    secretBox: new AesSecretBox(process.env.INTEGRATIONS_SECRET_KEY),
    isSandbox: async (tenantId) => {
      await clocks.refresh(tenantId);

      return clocks.isSandbox(tenantId);
    },
    allowPrivateUrls: env.NODE_ENV === "development",
    chat: async (ctx) => {
      const chosen = await integrations.resolver.primary(ctx, "chat");

      return {
        provider: integrations.catalog.get(chosen.providerId)?.manifest.name ?? chosen.providerId,
        post: (message) => chosen.adapter.post(message),
      };
    },
    classify: eventAudience,
    adminOrigin: env.ADMIN_ORIGIN,
  });

  const addresses = composeAddresses({
    uow,
    clocks,
    providers: {
      for: async (ctx) => (await integrations.resolver.chain(ctx, "address")).map((p) => p.adapter),
    },
    isSandbox: (ctx) => integrations.resolver.isSandbox(ctx.tenantId),
  });

  const producerOfRecord = makeProducerOfRecord(distributionDeps);

  const checkProducerLicense = makeCheckProducerLicense({
    ...distributionDeps,
    licensing: integrations.resolver.port("licensing"),
    placeName: jurisdictionName,
  });

  const manageProducers = makeManageProducers({
    ...distributionDeps,
    members: new PrismaMemberDirectory(prisma),
  });

  const distribution = {
    resolveBookScope: makeResolveBookScope(distributionDeps),
    producerOfRecord,
    checkLicense: checkProducerLicense,
    agencies: makeManageAgencies(distributionDeps),
    producers: manageProducers,
    rules: makeManageRules(distributionDeps),
    statements: makeAgencyStatement(distributionDeps),
  };

  const cardGateway = integrations.resolver.port("payments");
  const emailFor = integrations.resolver.port("email");

  const policy = {
    issueNewBusiness: makeIssueNewBusiness({
      uow,
      outbox,
      policies,
      invoices: { issue: issueInvoice },
      parties: { linkInsureds: linkPolicyInsureds },
      clocks,
    }),
    attachDocuments: makeAttachPolicyDocuments({ uow, policies, clocks }),
    list: makeListPolicies({ uow, policies }),
    get: makeGetPolicy({
      uow,
      policies,
      storage,
      config: { release: (ctx, id) => policyConfig.release(ctx, id) },
    }),
  };

  const secretBox = new AesSecretBox(process.env.INTEGRATIONS_SECRET_KEY);

  const carriers = composeApiCarriers({
    prisma,
    uow,
    clocks,
    storage,
    secrets: secretBox,
    isSandbox: (ctx) => integrations.resolver.isSandbox(ctx.tenantId),
    workflows: () => workflows,
    publicUrl: process.env.PUBLIC_API_URL ?? env.BETTER_AUTH_URL,
    sendEmail: async (ctx, message) => {
      await (await emailFor.for(ctx)).send(message);
    },
    senderName: async (ctx) => (await getProfile(ctx)).displayName,
    sources: {
      products: (ctx) => catalog.listProducts(ctx),
      releases: (ctx, productId) => makeListProductReleases({ uow, releases })(ctx, { productId }),
      release: (ctx, id) => productCatalog.getRelease(ctx, id),
      policies: (ctx, scope) => policy.list(ctx, scope, { limit: 1000 }),
      policy: (ctx, scope, id) => policy.get.detail(ctx, scope, { id }),
    },
  });

  const requestCarrierQuote = makeRequestCarrierQuote({
    uow,
    outbox,
    quotes,
    submissions,
    catalog: productCatalog,
    carrier: carriers.gateway,
    clocks,
  });

  const compliance = composeCompliance({
    uow,
    outbox,
    clocks,
    storage,
    policies: {
      transaction: makeGetTransactionFacts({ uow, policies }),
      release: async (ctx, id) => {
        const r = await productCatalog.getRelease(ctx, id);

        return { id: r.id, market: r.market, rules: r.rules };
      },
    },
    timeline: {
      record: (tx, ctx, input) =>
        recordPolicyEvent(tx, ctx, { ...input, actor: { type: "system", name: "Compliance" } }),
    },
    channels: filingChannelsFrom(integrations),
    tenantName: async (ctx) => (await getProfile(ctx)).displayName,
  });

  const agencyDownloads = composeAgencyDownloads({
    uow,
    outbox,
    clocks,
    storage,
    channels: agencyDownloadChannelsFrom(integrations),
    policy: {
      facts: makeGetTransactionFacts({ uow, policies }),
      financials: makeGetTransactionFinancials({ uow, policies }),
      policies: policy.get,
      products: { get: catalog.getProduct, list: catalog.listProducts },
    },
    agencies: distribution.agencies,
    statements: distribution.statements,
    obligations: compliance.tracked,
    tenantName: async (ctx) => (await getProfile(ctx)).displayName,
    workflows: () => workflows,
  });

  const nativeLedger = composeApiLedger({
    uow,
    outbox,
    clocks,
    listInvoices: makeListInvoices({ uow, invoices }),
    commissionFacts: makeCommissionFacts(distributionDeps),
    invoices,
    billingEvents: billingEvents.events,
    applyEvent: applyBillingEvent,
    payments: cardGateway,
    resolver: integrations.resolver,
  });

  const applyPayment = nativeLedger.cardPaymentsThroughLedger(
    makeApplyPayment({ applyEvent: applyBillingEvent, clocks }),
  );

  const setAutopay = makeSetAutopay({
    uow,
    schedules,
    applyEvent: applyBillingEvent,
    clocks,
    gateway: cardGateway,
    enroll: enrollAutopay,
  });

  const listInvoices = makeListInvoices({ uow, invoices });
  const payInvoice = makePayInvoice({ uow, invoices, gateway: cardGateway, applyPayment });
  const listChangeRequests = makeListChangeRequests({ uow, policies, changeRequests });
  const requestChange = makeRequestPolicyChange({ uow, outbox, policies, changeRequests, clocks });
  const partyRepos = { accounts: clientAccounts, parties: policyParties, users: clientUsers };

  const policyDirectory = {
    list: (ctx: TenantContext, policyIds: readonly string[]) =>
      policy.list(ctx, party(policyIds), { limit: 500 }),
    detail: (ctx: TenantContext, policyIds: readonly string[], id: string) =>
      policy.get.detail(ctx, party(policyIds), { id }),
    document: (
      ctx: TenantContext,
      policyIds: readonly string[],
      input: { policyId: string; documentId: string },
    ) => policy.get.document(ctx, party(policyIds), input),
    changeRequests: (ctx: TenantContext, policyIds: readonly string[], policyId: string) =>
      listChangeRequests(ctx, party(policyIds), { policyId }),
    requestChange: (
      ctx: TenantContext,
      policyIds: readonly string[],
      input: {
        policyId: string;
        kind: string;
        details: string;
        requester: { userId: string; name: string; email: string };
      },
    ) =>
      requestChange(ctx, party(policyIds), {
        ...input,
        requester: { type: "client", ...input.requester },
      }),
  };

  const billingDirectory = {
    invoices: (ctx: TenantContext, policyIds: readonly string[]) =>
      listInvoices.forPolicies(ctx, { policyIds }),
    invoice: (ctx: TenantContext, id: string) => listInvoices.byId(ctx, { id }),
    pay: (ctx: TenantContext, input: Parameters<BillingDirectory["pay"]>[1]) =>
      payInvoice(ctx, { ...input, card: { kind: "card", ...input.card } }),
  };

  const portal = {
    policies: policyDirectory,
    billing: billingDirectory,
    producers: new PrismaProducerDirectory(prisma),
  };

  const parties = {
    resolveScope: makeResolveClientScope({ uow, ...partyRepos, clocks }),
    claim: makeClaimClientPolicy({ uow, outbox, ...partyRepos, clocks }),
    profile: makeGetClientProfile({ uow, accounts: clientAccounts }),
    policies: makeListClientPolicies(portal),
    policy: makeGetClientPolicy(portal),
    invoices: makeClientInvoices(portal),
    requestChange: makeRequestClientChange({ ...portal, addresses }),
    search: makeSearchClientAccounts({ uow, ...partyRepos }),
    merge: makeMergeClientAccounts({ uow, outbox, ...partyRepos, clocks }),
    policyClients: makeGetPolicyClients({ uow, ...partyRepos }),
    account: makeGetClientAccount({ uow, ...partyRepos }),
    resendInvite: makeResendPortalInvite({ uow, outbox, ...partyRepos, clocks }),
  };

  const enrichmentExtensions = composeEnrichmentExtensions({
    extensions,
    resolver: integrations.resolver,
  });

  const enrichment = composeRiskEnricher({
    uow,
    clocks,
    storage,
    providers: integrations.resolver.dataProviders,
    branding: (ctx) => documentBranding(ctx),
    productName: (ctx, productId) => productCatalog.productName(ctx, productId),
    jurisdictionName,
    transforms: enrichmentExtensions.transforms,
  });

  const evaluation = {
    rater: new RatingModuleQuoteRater(
      makeRateRisk({ models: workbookModels, extensions: extensions.rater }),
    ),
    enricher: enrichment.enricher,
    clocks,
    extensions: extensions.invoker,
  };

  const documentBranding = async (ctx: TenantContext) => {
    const profile = await getProfile(ctx);

    return {
      name: profile.displayName,
      primaryColor: profile.primaryColor,
      ...(profile.supportEmail && { supportEmail: profile.supportEmail }),
      ...(profile.supportPhone && { supportPhone: profile.supportPhone }),
    };
  };

  const quoteDocuments = new ReactPdfQuoteDocuments({
    formEdition: formLibrary.getFile,
    jurisdictionName,
    branding: documentBranding,
    extensions: extensions.invoker,
  });

  const quoting = { uow, outbox, submissions, quotes, catalog: productCatalog, journey, clocks };
  const saveDraft = makeSaveDraft({ uow, submissions, clocks });
  const getSubmission = makeGetSubmission({ uow, submissions, quotes, catalog: productCatalog });
  const getQuote = makeGetQuote({ uow, submissions, quotes });
  const decideReferral = makeDecideReferral({ ...quoting, ...evaluation });
  const recordQuoteActivity = makeRecordQuoteActivity({ quotes, clocks });

  const underwriting = composeUnderwriting({
    prisma,
    uow,
    outbox,
    clocks,
    storage,
    quotes: new SubmissionsQuoteDesk({
      get: getSubmission,
      quote: getQuote,
      preview: makePreviewReferralApproval({ ...quoting, ...evaluation }),
      decide: decideReferral,
    }),
    timeline: {
      record: (tx, ctx, { quoteId, policyId, ...entry }) =>
        policyId
          ? recordPolicyEvent(tx, ctx, { policyId, ...entry })
          : recordQuoteActivity(tx, ctx, { quoteId, ...entry }),
    },
    inspectors: integrations.resolver.port("inspections"),
  });

  const policyRelease = async (ctx: TenantContext, id: string): Promise<PolicyRelease> => {
    const r = await productCatalog.getRelease(ctx, id);

    return {
      id: r.id,
      productId: r.productId,
      version: r.version,
      jurisdiction: r.jurisdiction,
      riskSchema: r.riskSchema,
      forms: r.forms,
      rules: r.rules,
      documents: r.documents,
      lifecycle: r.lifecycle,
      extensions: r.extensions,
    };
  };

  const policyConfig: PolicyProductConfig = {
    release: policyRelease,
    publishedReleases: async (ctx, input) => {
      const listed = await makeListProductReleases({ uow, releases })(ctx, {
        productId: input.productId,
      });

      const ids = listed
        .filter((r) => sameJurisdiction(r.jurisdiction, input.jurisdiction))
        .toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .map((r) => r.id);

      return Promise.all(ids.map((id) => policyRelease(ctx, id)));
    },
  };

  const termRater: TermRater = makeRateTerm({ ...evaluation, catalog: productCatalog });

  const noticeDelivery = new PortNoticeDelivery({
    emails: async (ctx, policyId) =>
      (await parties.policyClients(ctx, { policyId })).flatMap((c) =>
        c.emails.map((e) => e.address),
      ),
    sendEmail: async (ctx, message) => {
      await (await emailFor.for(ctx)).send(message);
    },
    sendLetter: integrations.sendLetter,
    // Tenant profiles have no postal address yet; real print & mail needs one (TODO.md).
    returnAddress: async (ctx) => ({
      name: (await getProfile(ctx)).displayName,
      line1: "",
      city: "",
      region: "",
      postalCode: "",
      country: "US",
    }),
  });

  const billingMethods = composeApiBillingMethods({
    uow,
    clocks,
    storage,
    policies,
    billingEvents,
    applyEvent: applyBillingEvent,
    schedules,
    mortgageeBills,
    agencyBilling: makeAgencyBilling(distributionDeps),
    producerOfRecord,
    branding: documentBranding,
    mail: {
      sendEmail: async (ctx, message) => {
        await (await emailFor.for(ctx)).send(message);
      },
      sendLetter: integrations.sendLetter,
      // Tenant profiles have no postal address yet; real print & mail needs one (TODO.md).
      returnAddress: async (ctx) => ({
        name: (await getProfile(ctx)).displayName,
        line1: "",
        city: "",
        region: "",
        postalCode: "",
        country: "US",
      }),
      insuredEmails: async (ctx, policyId) =>
        (await parties.policyClients(ctx, { policyId })).flatMap((c) =>
          c.emails.map((e) => e.address),
        ),
      appUrl: async (ctx) => (await getProfile(ctx)).appUrls[0]!,
    },
  });

  const billingStatus = {
    pastDue: async (ctx: TenantContext, policyId: string) =>
      (
        await uow.run(ctx, async (tx) => pastDueOf(await invoices.listByPolicy(tx, ctx, policyId)))
      )?.toJSON() ?? null,
  };

  const policyChanges = {
    uow,
    outbox,
    policies,
    invoices: { issue: issueInvoice },
    config: policyConfig,
    rater: termRater,
    clocks,
    storage,
    notices: new ReactPdfNoticeDocuments({
      branding: documentBranding,
      jurisdictionName,
      extensions: extensions.invoker,
    }),
    delivery: noticeDelivery,
    billing: billingStatus,
    carriers: carriers.transactions,
    extensions: extensions.invoker,
  };

  const quoteEndorsement = makeQuoteEndorsement(policyChanges);

  const renderQuotePacket = makeRenderQuotePacket({
    ...quoting,
    documents: quoteDocuments,
  });

  const resolveTenantByHost = makeResolveTenantByHost({
    directory: tenantDirectory,
    hosts: appHosts,
  });

  const environments = new PrismaTenantEnvironmentRepository();

  const runDescriberDeps: RunDescriberDeps = {
    obligations: compliance.timers,
    installments: makeInstallmentTimers({
      ...billingEvents,
      uow,
      schedules,
      gateway: cardGateway,
      applyEvent: applyBillingEvent,
      notices: { remind: async () => [] },
    }),
    terms: makeTermTimers({
      uow,
      outbox,
      policies,
      invoices: { issue: issueInvoice },
      clocks,
    }),
    quotes: makeQuoteTimers({ uow, outbox, quotes, clocks }),
    inspections: underwriting.inspectionTimers,
    subjectivities: underwriting.subjectivityTimers,
    agencyStatements: billingMethods.statements,
    mortgagee: billingMethods.mortgagee,
  };

  const sandboxTimers = makeSandboxTimers({ workflows, ...runDescriberDeps });
  const searchIndex = new PostgresSearchIndex();
  const search = makeSearch({ uow, index: searchIndex });

  const recentViews = makeRecentViews({
    uow,
    index: searchIndex,
    views: new PrismaRecentViews(),
    clocks,
  });

  const workflowRuns = makeWorkflowRuns({
    workflows,
    describe: makeRunDescriber(runDescriberDeps),
    search,
    clocks,
    queues,
  });

  const auth = createAuth({
    prisma,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.ADMIN_ORIGIN, env.APP_ORIGIN, tenantOriginPattern(env.APP_ORIGIN)],
    isTrustedTenantOrigin: async (origin) =>
      URL.canParse(origin) &&
      (await resolveTenantByHost({ host: new URL(origin).host })).status === "tenant",
    onInvitationAccepted: ({ organizationId, ...user }) =>
      manageProducers.linkUser(
        { tenantId: asId(organizationId), actor: { type: "system", process: "auth" } },
        user,
      ),
    sendSignInCode: async ({ email, code, headers }) => {
      const resolved = await resolveTenantByHost({
        host: headers?.get("x-pas-host") ?? headers?.get("host") ?? "",
        slug: headers?.get("x-pas-tenant"),
      });

      const sender =
        resolved.status === "tenant"
          ? await emailFor.for({
              tenantId: asId(resolved.tenantId),
              actor: { type: "system", process: "auth" },
            })
          : mailer;

      await sender.send({
        to: email,
        tag: "client_sign_in_code",
        subject: `Your sign-in code is ${code}`,
        text: `Your sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      });
    },
  });

  const clientRequests = new PrismaClientRequestRepository();
  // The link MAC reuses the auth secret under its own purpose prefix (see HmacClientLinks).
  const clientLinks = new HmacClientLinks(env.BETTER_AUTH_SECRET);

  const clientLinkUrl = async (ctx: TenantContext, requestId: string) =>
    new URL(
      clientApplicationPath(clientLinks.token(requestId)),
      (await getProfile(ctx)).appUrls[0],
    ).toString();

  const signQuote = makeSignQuote({
    ...quoting,
    renderPacket: renderQuotePacket,
    esign: integrations.resolver.port("esign"),
    storage,
  });

  const bindQuote = makeBindQuote({
    ...quoting,
    ...evaluation,
    addresses,
    payments: cardGateway,
    licensing: {
      check: (ctx, input) => checkProducerLicense(ctx, { ...input, userId: input.producerId }),
    },
    policies: {
      issue: async (ctx, request) => {
        const record = await producerOfRecord(ctx, {
          userId: request.producer.id,
          agencyId: request.producer.agencyId,
        });

        return policy.issueNewBusiness(ctx, {
          ...(request as Parameters<typeof policy.issueNewBusiness>[1]),
          producer: {
            ...request.producer,
            agencyId: record.agencyId,
            agencyName: record.agencyName,
          },
        });
      },
      attachDocuments: policy.attachDocuments,
      applyPayment: async (ctx, input) => {
        await applyPayment(ctx, input);
      },
      enrollAutopay,
    },
    documents: quoteDocuments,
    storage,
    conditions: { outstanding: underwriting.outstanding },
    agencyBilling: billingMethods.agencyBillCheck,
    carrier: carriers.gateway,
  });

  const clientApplication = makeClientApplication({
    ...quoting,
    requests: clientRequests,
    links: clientLinks,
    sign: signQuote,
    bind: bindQuote,
    packet: renderQuotePacket,
  });

  const listSubmissions = makeListSubmissions({
    uow,
    submissions,
    quotes,
    catalog: productCatalog,
  });

  return {
    logger,
    auth,
    prisma,
    queues,
    workflows,
    clocks,
    integrations,
    events,
    carriers,
    extensions,
    mockCarrier: env.NODE_ENV === "production" ? null : mockCarrier(),
    useCases: {
      catalog: {
        createProduct: makeCreateProduct({ uow, outbox, products, clocks }),
        ...catalog,
        listAvailableProducts: makeListAvailableProducts({ uow, products, releases }),
        dataProviders: enrichmentExtensions.directory.providers,
        listVersions: makeListProductVersions({ uow, versions }),
        getVersion: makeGetProductVersion({ uow, versions }),
        createVersion: makeCreateProductVersion({ uow, outbox, products, versions, clocks }),
        updateVersion: makeUpdateProductVersion({ uow, versions, clocks }),
        submitVersion: makeSubmitProductVersion({ uow, outbox, versions, clocks }),
        reopenVersion: makeReturnProductVersionToDraft({ uow, outbox, versions, clocks }),
        retireVersion: makeRetireProductVersion({ uow, outbox, versions, clocks }),
        checkVersion: makeCheckProductVersion({
          uow,
          versions,
          formEditions: formEditionDirectory,
          rating: ratingVerifier,
          carriers: { verify: carriers.services.verify },
          extensions: { verify: extensions.verifyBindings },
          enrichment: enrichmentExtensions.directory,
        }),
        publishVersion: makePublishProductVersion({
          uow,
          outbox,
          products,
          versions,
          releases,
          formEditions: formEditionDirectory,
          rating: ratingVerifier,
          carriers: { verify: carriers.services.verify },
          extensions: { verify: extensions.verifyBindings },
          enrichment: enrichmentExtensions.directory,
          clocks,
        }),
        listReleases: makeListProductReleases({ uow, releases }),
      },
      formLibrary,
      rating,
      submissions: {
        start: makeStartSubmission({
          uow,
          outbox,
          submissions,
          catalog: productCatalog,
          clocks,
        }),
        get: getSubmission,
        saveDraft,
        fieldOptions: makeFieldOptions({ ...quoting, extensions: extensions.invoker }),
        fieldPrefill: makeFieldPrefill({ ...quoting, extensions: extensions.invoker }),
        panel: makeSubmissionPanel({ ...quoting, extensions: extensions.invoker }),
        action: makeRunSubmissionAction({ ...quoting, extensions: extensions.invoker, saveDraft }),
        submit: makeSubmitSubmission({ ...quoting, ...evaluation, addresses }),
        clearance: makeCheckSubmissionClearance({
          uow,
          submissions,
          catalog: productCatalog,
          addresses,
        }),
        list: listSubmissions,
      },
      quotes: {
        get: getQuote,
        customize: makeCustomizeQuote({ ...quoting, ...evaluation }),
        saveDetails: makeSaveBindDetails({
          uow,
          submissions,
          quotes,
          clocks,
          addresses,
          catalog: productCatalog,
        }),
        sendToClient: makeSendToClient({ ...quoting, requests: clientRequests }),
        completion: makeGetClientCompletion({ ...quoting, requests: clientRequests }),
        packet: renderQuotePacket,
        enrichment: makeGetQuoteEnrichment({
          uow,
          submissions,
          quotes,
          records: enrichment.records,
          reports: enrichment.reports,
          catalog: productCatalog,
        }),
        sign: signQuote,
        bind: bindQuote,
        decideReferral,
        choosePayPlan: makeChoosePayPlan({ uow, submissions, quotes, clocks }),
        billingOptions: makeBillingOptions({
          uow,
          submissions,
          quotes,
          catalog: productCatalog,
          agencyBilling: billingMethods.agencyBillCheck,
        }),
        checkout: async (ctx: TenantContext) => (await cardGateway.for(ctx)).checkout,
      },
      parties,
      compliance,
      agencyDownloads,
      underwriting,
      addresses,
      distribution,
      billing: {
        statements: billingMethods.statements,
        mortgagee: billingMethods.mortgagee,
        simulationAvailable: nativeLedger.simulationAvailable,
        applyEvent: applyBillingEvent,
      },
      ledger: { ...nativeLedger.ledger, isNative: nativeLedger.isNative },
      search,
      recentViews,
      workflowRuns,
      clientApplication,
      clientLinkUrl,
      actionItems: makeActionItems({
        submissions: listSubmissions,
        policies: policy.list,
        invoices: (ctx: TenantContext, policyIds: readonly string[]) =>
          listInvoices.forPolicies(ctx, { policyIds }),
        underwriting: underwriting.producerActions,
        clocks,
      }),
      clientDetail: makeClientDetail({
        account: parties.account,
        policies: policy.get,
        submission: getSubmission,
      }),
      policies: {
        list: policy.list,
        get: policy.get,
        extensions: makePolicyExtensions({
          uow,
          policies,
          config: policyConfig,
          extensions: extensions.invoker,
        }),
        changeRequests: listChangeRequests,
        changeProducer: makeChangeProducer({ uow, outbox, policies, clocks }),
        billing: async (ctx: TenantContext, scope: PolicyScope, input: { id: string }) => {
          await policy.get.detail(ctx, scope, input);

          return getPolicyBilling(ctx, { policyId: input.id });
        },
        setAutopay: async (
          ctx: TenantContext,
          scope: PolicyScope,
          input: Omit<Parameters<typeof setAutopay>[1], "payer"> & { payerName: string },
        ) => {
          const detail = await policy.get.detail(ctx, scope, { id: input.policyId });
          const { payerName, ...rest } = input;

          return setAutopay(ctx, { ...rest, payer: { name: payerName || detail.insuredName } });
        },
        payInvoice: async (
          ctx: TenantContext,
          scope: PolicyScope,
          input: Parameters<typeof payInvoice>[1] & { policyId: string },
        ) => {
          await policy.get.detail(ctx, scope, { id: input.policyId });

          return payInvoice(ctx, input);
        },
        cureNonpayment: makeCureNonpayment(policyChanges),
        switchToDirect: async (
          ctx: TenantContext,
          scope: PolicyScope,
          input: Parameters<typeof billingMethods.mortgagee.switchToDirect>[1],
        ) => {
          await policy.get.detail(ctx, scope, { id: input.policyId });

          return billingMethods.mortgagee.switchToDirect(ctx, input);
        },
        applyBillingEvent,
        endorsementSetup: makeGetEndorsementSetup(policyChanges),
        risk: makeGetPolicyRisk(policyChanges),
        quoteEndorsement: async (
          ...[ctx, scope, input]: Parameters<ReturnType<typeof makeQuoteEndorsement>>
        ) =>
          quoteEndorsement(ctx, scope, {
            ...input,
            ...(input.risk && { risk: await addresses.stampDocument(ctx, input.risk) }),
            ...(input.parties && { parties: await addresses.stampDocument(ctx, input.parties) }),
          }),
        issueTransaction: makeIssueTransaction(policyChanges),
        discardTransaction: makeDiscardTransaction(policyChanges),
        cancellationReasons: makeCancellationReasons(policyChanges),
        quoteCancellation: makeQuoteCancellation(policyChanges),
        initiateCancellation: makeInitiateCancellation(policyChanges),
        rescindCancellation: makeRescindCancellation(policyChanges),
        quoteReinstatement: makeQuoteReinstatement(policyChanges),
        reinstate: makeReinstatePolicy(policyChanges),
      },
      tenants: {
        getProfile,
        updateProfile: makeUpdateProfile({
          uow,
          outbox,
          profiles: tenantProfiles,
          directory: tenantDirectory,
          hosts: appHosts,
          clocks,
        }),
        resolveTenantByHost,
        listTenants: makeListTenants({ directory: tenantDirectory }),
        environment: makeGetEnvironment({ uow, environments, clocks }),
        createSandbox: makeCreateSandbox({
          uow,
          outbox,
          environments,
          profiles: tenantProfiles,
          organizations: new PrismaSandboxOrganizations(prisma, sandboxAccess(prisma)),
          seeds: [
            new PrismaFormEditionCloner(uow),
            new PrismaRaterWorkbookCloner(uow),
            new PrismaExtensionCloner(uow, secretBox),
            new PrismaCatalogCloner(uow),
            new PrismaDistributionCloner(uow),
            new PrismaUnderwritingSettingsCloner(uow),
            new PrismaCarrierCloner(uow, secretBox),
          ],
          clocks,
        }),
        sandboxTime: makeSandboxTime({
          uow,
          outbox,
          environments,
          timers: sandboxTimers,
          clocks,
        }),
      },
    },
  };
}

function tenantOriginPattern(origin: string): string {
  const url = new URL(origin);

  return `${url.protocol}//*.${url.host}`;
}

export type Container = ReturnType<typeof compose>;

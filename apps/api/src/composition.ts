import { createAuth } from "@pas/auth";
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
  makeApplyPayment,
  makeGetPolicyBilling,
  makeIssueInvoice,
  makeListInvoices,
  makePayInvoice,
} from "@pas/billing";
import { PrismaInvoiceRepository } from "@pas/billing/infrastructure";
import {
  makeAttachPolicyDocuments,
  makeCancellationReasons,
  makeDiscardTransaction,
  makeGetEndorsementSetup,
  makeGetPolicy,
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
  type PolicyProductConfig,
  type PolicyRelease,
  type PolicyScope,
  type TermRater,
} from "@pas/policy";
import {
  PrismaChangeRequestRepository,
  PrismaPolicyRepository,
  ReactPdfNoticeDocuments,
} from "@pas/policy/infrastructure";
import {
  type BillingDirectory,
  makeClaimClientPolicy,
  makeClientInvoices,
  makeGetClientPolicy,
  makeGetClientProfile,
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
import { builtinProviders, composeIntegrations } from "@pas/integrations/infrastructure";
import { makeSearch } from "@pas/search";
import { PostgresSearchIndex } from "@pas/search/infrastructure";
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
  makeBindQuote,
  makeCustomizeQuote,
  makeDecideReferral,
  makeGetQuote,
  makeRateTerm,
  makeGetSubmission,
  makeListSubmissions,
  makeRenderQuotePacket,
  makeSaveBindDetails,
  makeSaveDraft,
  makeSignQuote,
  makeQuoteTimers,
  makeStartSubmission,
  makeSubmitSubmission,
  QuoteJourney,
} from "@pas/submissions";
import {
  CatalogProductCatalog,
  ClickToSignGateway,
  FakeCardGateway,
  PassThroughRiskEnricher,
  PrismaQuoteRepository,
  PrismaSubmissionRepository,
  RatingModuleQuoteRater,
  ReactPdfQuoteDocuments,
} from "@pas/submissions/infrastructure";
import { createLogger } from "@pas/observability";
import { PgBossOutbox, QueueClient, queueConnectionFromEnv } from "@pas/queues";
import { createStorageFromEnv } from "@pas/storage";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { PostgresWorkflows, workflowConnectionFromEnv } from "@pas/workflows";
import { env } from "./env";
import { sandboxAccess } from "./sandbox-access";
import { makeSandboxTimers } from "./sandbox-timers";

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
    check: makeCheckRating({ models: workbookModels }),
    preview: makePreviewRating({ models: workbookModels }),
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

  const journey = new QuoteJourney(workflows);
  const quotes = new PrismaQuoteRepository();
  const policies = new PrismaPolicyRepository();

  const invoices = new PrismaInvoiceRepository();
  const issueInvoice = makeIssueInvoice({ invoices, clocks });
  const recordPolicyEvent = makeRecordPolicyEvent({ policies, clocks });
  const getPolicyBilling = makeGetPolicyBilling({ uow, invoices });

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
    builtins: builtinProviders({
      payments: new FakeCardGateway(clocks),
      esign: new ClickToSignGateway(),
      email: mailer,
    }),
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
    get: makeGetPolicy({ uow, policies, storage }),
  };

  const applyPayment = makeApplyPayment({
    uow,
    invoices,
    timeline: { record: (tx, ctx, entry) => recordPolicyEvent(tx, ctx, entry) },
    clocks,
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
    requestChange: makeRequestClientChange(portal),
    search: makeSearchClientAccounts({ uow, ...partyRepos }),
    merge: makeMergeClientAccounts({ uow, outbox, ...partyRepos, clocks }),
    policyClients: makeGetPolicyClients({ uow, ...partyRepos }),
    resendInvite: makeResendPortalInvite({ uow, outbox, ...partyRepos, clocks }),
  };

  const evaluation = {
    rater: new RatingModuleQuoteRater(makeRateRisk({ models: workbookModels })),
    enricher: new PassThroughRiskEnricher(),
    clocks,
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
  });

  const quoting = { uow, outbox, submissions, quotes, catalog: productCatalog, journey, clocks };

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

  const policyChanges = {
    uow,
    outbox,
    policies,
    invoices: { issue: issueInvoice },
    config: policyConfig,
    rater: termRater,
    clocks,
    storage,
    notices: new ReactPdfNoticeDocuments({ branding: documentBranding, jurisdictionName }),
  };

  const renderQuotePacket = makeRenderQuotePacket({
    ...quoting,
    documents: quoteDocuments,
  });

  const resolveTenantByHost = makeResolveTenantByHost({
    directory: tenantDirectory,
    hosts: appHosts,
  });

  const environments = new PrismaTenantEnvironmentRepository();

  const sandboxTimers = makeSandboxTimers({
    workflows,
    terms: makeTermTimers({
      uow,
      outbox,
      policies,
      invoices: { issue: issueInvoice },
      clocks,
    }),
    quotes: makeQuoteTimers({ uow, outbox, quotes, clocks }),
  });

  const auth = createAuth({
    prisma,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.ADMIN_ORIGIN, env.APP_ORIGIN, tenantOriginPattern(env.APP_ORIGIN)],
    isTrustedTenantOrigin: async (origin) =>
      URL.canParse(origin) &&
      (await resolveTenantByHost({ host: new URL(origin).host })).status === "tenant",
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

  return {
    logger,
    auth,
    prisma,
    queues,
    workflows,
    clocks,
    integrations,
    useCases: {
      catalog: {
        createProduct: makeCreateProduct({ uow, outbox, products, clocks }),
        ...catalog,
        listAvailableProducts: makeListAvailableProducts({ uow, products, releases }),
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
        }),
        publishVersion: makePublishProductVersion({
          uow,
          outbox,
          products,
          versions,
          releases,
          formEditions: formEditionDirectory,
          rating: ratingVerifier,
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
        get: makeGetSubmission({ uow, submissions, quotes, catalog: productCatalog }),
        saveDraft: makeSaveDraft({ uow, submissions, clocks }),
        submit: makeSubmitSubmission({ ...quoting, ...evaluation }),
        list: makeListSubmissions({ uow, submissions, quotes, catalog: productCatalog }),
      },
      quotes: {
        get: makeGetQuote({ uow, submissions, quotes }),
        customize: makeCustomizeQuote({ ...quoting, ...evaluation }),
        saveDetails: makeSaveBindDetails({ uow, submissions, quotes, clocks }),
        packet: renderQuotePacket,
        sign: makeSignQuote({
          ...quoting,
          renderPacket: renderQuotePacket,
          esign: integrations.resolver.port("esign"),
          storage,
        }),
        bind: makeBindQuote({
          ...quoting,
          ...evaluation,
          payments: cardGateway,
          policies: {
            issue: policy.issueNewBusiness,
            attachDocuments: policy.attachDocuments,
            applyPayment: async (ctx, input) => {
              await applyPayment(ctx, input);
            },
          },
          documents: quoteDocuments,
          storage,
        }),
        decideReferral: makeDecideReferral(quoting),
        checkout: async (ctx: TenantContext) => (await cardGateway.for(ctx)).checkout,
      },
      parties,
      search: makeSearch({ uow, index: new PostgresSearchIndex() }),
      policies: {
        list: policy.list,
        get: policy.get,
        changeRequests: listChangeRequests,
        billing: async (ctx: TenantContext, scope: PolicyScope, input: { id: string }) => {
          await policy.get.detail(ctx, scope, input);

          return getPolicyBilling(ctx, { policyId: input.id });
        },
        endorsementSetup: makeGetEndorsementSetup(policyChanges),
        quoteEndorsement: makeQuoteEndorsement(policyChanges),
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
            new PrismaCatalogCloner(uow),
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

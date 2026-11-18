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
import { PdfLibInspector, PrismaFormEditionRepository } from "@pas/form-library/infrastructure";
import { systemClock, type TenantContext } from "@pas/kernel";
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
  makeGetPolicy,
  makeIssueNewBusiness,
  makeListChangeRequests,
  makeListPolicies,
  makeRequestPolicyChange,
  makeRecordPolicyEvent,
  type PolicyScope,
} from "@pas/policy";
import { PrismaChangeRequestRepository, PrismaPolicyRepository } from "@pas/policy/infrastructure";
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
import { PrismaRaterWorkbookRepository } from "@pas/rating/infrastructure";
import {
  AppHosts,
  makeGetProfile,
  makeListTenants,
  makeResolveTenantByHost,
  makeUpdateProfile,
} from "@pas/tenants";
import { PrismaTenantDirectory, PrismaTenantProfileRepository } from "@pas/tenants/infrastructure";
import {
  makeBindQuote,
  makeCustomizeQuote,
  makeDecideReferral,
  makeGetQuote,
  makeGetSubmission,
  makeListSubmissions,
  makeRenderQuotePacket,
  makeSaveBindDetails,
  makeSaveDraft,
  makeSignQuote,
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

const party = (policyIds: readonly string[]) => ({ kind: "party" as const, policyIds });

export function compose() {
  const logger = createLogger("api");
  const prisma = getPrismaClient();
  const queues = new QueueClient(queueConnectionFromEnv(), logger);

  const uow = new PrismaUnitOfWork(prisma);
  const outbox = new PgBossOutbox(queues);
  const clock = systemClock;

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
      clock,
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
      clock,
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
  const workflows = new PostgresWorkflows({ ...workflowConnectionFromEnv(), logger });
  const journey = new QuoteJourney(workflows);
  const quotes = new PrismaQuoteRepository();
  const policies = new PrismaPolicyRepository();

  const invoices = new PrismaInvoiceRepository();
  const issueInvoice = makeIssueInvoice({ invoices, clock });
  const recordPolicyEvent = makeRecordPolicyEvent({ policies, clock });
  const getPolicyBilling = makeGetPolicyBilling({ uow, invoices });

  const clientAccounts = new PrismaClientAccountRepository();
  const policyParties = new PrismaPolicyPartyRepository();
  const clientUsers = new PrismaClientUserRepository();
  const changeRequests = new PrismaChangeRequestRepository();
  const cardGateway = new FakeCardGateway(clock);

  const linkPolicyInsureds = makeLinkPolicyInsureds({
    accounts: clientAccounts,
    parties: policyParties,
    outbox,
    clock,
  });

  const policy = {
    issueNewBusiness: makeIssueNewBusiness({
      uow,
      outbox,
      policies,
      invoices: { issue: issueInvoice },
      parties: { linkInsureds: linkPolicyInsureds },
      clock,
    }),
    attachDocuments: makeAttachPolicyDocuments({ uow, policies, clock }),
    list: makeListPolicies({ uow, policies }),
    get: makeGetPolicy({ uow, policies, storage }),
  };

  const applyPayment = makeApplyPayment({
    uow,
    invoices,
    timeline: { record: (tx, ctx, entry) => recordPolicyEvent(tx, ctx, entry) },
    clock,
  });

  const listInvoices = makeListInvoices({ uow, invoices });
  const payInvoice = makePayInvoice({ uow, invoices, gateway: cardGateway, applyPayment });
  const listChangeRequests = makeListChangeRequests({ uow, policies, changeRequests });
  const requestChange = makeRequestPolicyChange({ uow, outbox, policies, changeRequests, clock });
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
    resolveScope: makeResolveClientScope({ uow, ...partyRepos, clock }),
    claim: makeClaimClientPolicy({ uow, outbox, ...partyRepos, clock }),
    profile: makeGetClientProfile({ uow, accounts: clientAccounts }),
    policies: makeListClientPolicies(portal),
    policy: makeGetClientPolicy(portal),
    invoices: makeClientInvoices(portal),
    requestChange: makeRequestClientChange(portal),
    search: makeSearchClientAccounts({ uow, ...partyRepos }),
    merge: makeMergeClientAccounts({ uow, outbox, ...partyRepos, clock }),
    policyClients: makeGetPolicyClients({ uow, ...partyRepos }),
    resendInvite: makeResendPortalInvite({ uow, outbox, ...partyRepos, clock }),
  };

  const evaluation = {
    rater: new RatingModuleQuoteRater(makeRateRisk({ models: workbookModels })),
    enricher: new PassThroughRiskEnricher(),
    clock,
  };

  const quoteDocuments = new ReactPdfQuoteDocuments({
    formEdition: formLibrary.getFile,
    jurisdictionName,
    branding: async (ctx) => {
      const profile = await getProfile(ctx);

      return {
        name: profile.displayName,
        primaryColor: profile.primaryColor,
        ...(profile.supportEmail && { supportEmail: profile.supportEmail }),
        ...(profile.supportPhone && { supportPhone: profile.supportPhone }),
      };
    },
  });

  const quoting = { uow, outbox, submissions, quotes, catalog: productCatalog, journey, clock };

  const renderQuotePacket = makeRenderQuotePacket({
    ...quoting,
    documents: quoteDocuments,
  });

  const resolveTenantByHost = makeResolveTenantByHost({
    directory: tenantDirectory,
    hosts: appHosts,
  });

  const mailer = new ConsoleMailer(logger);

  const auth = createAuth({
    prisma,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.ADMIN_ORIGIN, env.APP_ORIGIN, tenantOriginPattern(env.APP_ORIGIN)],
    isTrustedTenantOrigin: async (origin) =>
      URL.canParse(origin) &&
      (await resolveTenantByHost({ host: new URL(origin).host })).status === "tenant",
    sendSignInCode: ({ email, code }) =>
      mailer.send({
        to: email,
        tag: "client_sign_in_code",
        subject: `Your sign-in code is ${code}`,
        text: `Your sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
      }),
  });

  return {
    logger,
    auth,
    prisma,
    queues,
    workflows,
    useCases: {
      catalog: {
        createProduct: makeCreateProduct({ uow, outbox, products, clock }),
        ...catalog,
        listAvailableProducts: makeListAvailableProducts({ uow, products, releases }),
        listVersions: makeListProductVersions({ uow, versions }),
        getVersion: makeGetProductVersion({ uow, versions }),
        createVersion: makeCreateProductVersion({ uow, outbox, products, versions, clock }),
        updateVersion: makeUpdateProductVersion({ uow, versions, clock }),
        submitVersion: makeSubmitProductVersion({ uow, outbox, versions, clock }),
        reopenVersion: makeReturnProductVersionToDraft({ uow, outbox, versions, clock }),
        retireVersion: makeRetireProductVersion({ uow, outbox, versions, clock }),
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
          clock,
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
          clock,
        }),
        get: makeGetSubmission({ uow, submissions, quotes, catalog: productCatalog }),
        saveDraft: makeSaveDraft({ uow, submissions, clock }),
        submit: makeSubmitSubmission({ ...quoting, ...evaluation }),
        list: makeListSubmissions({ uow, submissions, quotes, catalog: productCatalog }),
      },
      quotes: {
        get: makeGetQuote({ uow, submissions, quotes }),
        customize: makeCustomizeQuote({ ...quoting, ...evaluation }),
        saveDetails: makeSaveBindDetails({ uow, submissions, quotes, clock }),
        packet: renderQuotePacket,
        sign: makeSignQuote({
          ...quoting,
          renderPacket: renderQuotePacket,
          esign: new ClickToSignGateway(),
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
      },
      parties,
      policies: {
        list: policy.list,
        get: policy.get,
        changeRequests: listChangeRequests,
        billing: async (ctx: TenantContext, scope: PolicyScope, input: { id: string }) => {
          await policy.get.detail(ctx, scope, input);

          return getPolicyBilling(ctx, { policyId: input.id });
        },
      },
      tenants: {
        getProfile,
        updateProfile: makeUpdateProfile({
          uow,
          outbox,
          profiles: tenantProfiles,
          directory: tenantDirectory,
          hosts: appHosts,
          clock,
        }),
        resolveTenantByHost,
        listTenants: makeListTenants({ directory: tenantDirectory }),
      },
    },
  };
}

function tenantOriginPattern(origin: string): string {
  const url = new URL(origin);

  return `${url.protocol}//*.${url.host}`;
}

export type Container = ReturnType<typeof compose>;

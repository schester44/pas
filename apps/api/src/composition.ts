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
import { makeApplyPayment, makeGetPolicyBilling, makeIssueInvoice } from "@pas/billing";
import { PrismaInvoiceRepository } from "@pas/billing/infrastructure";
import {
  makeAttachPolicyDocuments,
  makeGetPolicy,
  makeIssueNewBusiness,
  makeListPolicies,
  makeRecordPolicyEvent,
  type PolicyScope,
} from "@pas/policy";
import { PrismaPolicyRepository } from "@pas/policy/infrastructure";
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

  const policy = {
    issueNewBusiness: makeIssueNewBusiness({
      uow,
      outbox,
      policies,
      invoices: { issue: issueInvoice },
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

  const auth = createAuth({
    prisma,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.ADMIN_ORIGIN, env.APP_ORIGIN, tenantOriginPattern(env.APP_ORIGIN)],
    isTrustedTenantOrigin: async (origin) =>
      URL.canParse(origin) &&
      (await resolveTenantByHost({ host: new URL(origin).host })).status === "tenant",
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
          payments: new FakeCardGateway(clock),
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
      policies: {
        list: policy.list,
        get: policy.get,
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

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
import { systemClock } from "@pas/kernel";
import {
  AppHosts,
  makeGetProfile,
  makeListTenants,
  makeResolveTenantByHost,
  makeUpdateProfile,
} from "@pas/tenants";
import { PrismaTenantDirectory, PrismaTenantProfileRepository } from "@pas/tenants/infrastructure";
import {
  makeGetSubmission,
  makeListSubmissions,
  makeSaveDraft,
  makeStartSubmission,
  makeSubmitSubmission,
} from "@pas/submissions";
import { CatalogProductCatalog, PrismaSubmissionRepository } from "@pas/submissions/infrastructure";
import { createLogger } from "@pas/observability";
import { PgBossOutbox, QueueClient, queueConnectionFromEnv } from "@pas/queues";
import { createStorageFromEnv } from "@pas/storage";
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

  const catalog = {
    listProducts: makeListProducts({ uow, products }),
    getProduct: makeGetProduct({ uow, products }),
    getRelease: makeGetProductRelease({ uow, releases }),
    resolveRelease: makeResolveRelease({ uow, products, releases }),
  };

  const productCatalog = new CatalogProductCatalog(catalog);

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
        }),
        publishVersion: makePublishProductVersion({
          uow,
          outbox,
          products,
          versions,
          releases,
          formEditions: formEditionDirectory,
          clock,
        }),
        listReleases: makeListProductReleases({ uow, releases }),
      },
      formLibrary,
      submissions: {
        start: makeStartSubmission({
          uow,
          outbox,
          submissions,
          catalog: productCatalog,
          clock,
        }),
        get: makeGetSubmission({ uow, submissions, catalog: productCatalog }),
        saveDraft: makeSaveDraft({ uow, submissions, clock }),
        submit: makeSubmitSubmission({
          uow,
          outbox,
          submissions,
          catalog: productCatalog,
          clock,
        }),
        list: makeListSubmissions({ uow, submissions, catalog: productCatalog }),
      },
      tenants: {
        getProfile: makeGetProfile({ uow, profiles: tenantProfiles, hosts: appHosts }),
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

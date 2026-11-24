import {
  makeGetProduct,
  makeGetProductRelease,
  makeListProductReleases,
  makeListProducts,
  makeResolveRelease,
} from "@pas/catalog";
import {
  PrismaProductReleaseRepository,
  PrismaProductRepository,
} from "@pas/catalog/infrastructure";
import type { PrismaClient } from "@pas/db";
import {
  type ClockProvider,
  type Outbox,
  sameJurisdiction,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { makeGetPolicyClients } from "@pas/parties";
import {
  PrismaClientAccountRepository,
  PrismaClientUserRepository,
  PrismaPolicyPartyRepository,
} from "@pas/parties/infrastructure";
import {
  type BillingStatus,
  type InvoiceIssuer,
  type PolicyProductConfig,
  type PolicyRelease,
  type PolicyRepository,
} from "@pas/policy";
import { PortNoticeDelivery, ReactPdfNoticeDocuments } from "@pas/policy/infrastructure";
import { type ExtensionRaterRunner, makeRateRisk, makeWorkbookModels } from "@pas/rating";
import type { BindingInvoker } from "@pas/extension-points";
import { PrismaRaterWorkbookRepository } from "@pas/rating/infrastructure";
import type { ObjectStorage } from "@pas/storage";
import { makeRateTerm, noEnrichment } from "@pas/submissions";
import { CatalogProductCatalog, RatingModuleQuoteRater } from "@pas/submissions/infrastructure";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";

/** The policy-change dependencies nonpayment needs in the worker (same wiring as apps/api). */
export function composePolicyServices(deps: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  policies: PolicyRepository;
  invoices: InvoiceIssuer;
  billing: BillingStatus;
  getProfile: (ctx: TenantContext) => Promise<{
    displayName: string;
    primaryColor: string;
    supportEmail: string | null;
    supportPhone: string | null;
  }>;
  sendEmail: (
    ctx: TenantContext,
    message: { to: string; subject: string; text: string; tag: string },
  ) => Promise<void>;
  sendLetter: ConstructorParameters<typeof PortNoticeDelivery>[0]["sendLetter"];
  extensions: { invoker: BindingInvoker; rater: ExtensionRaterRunner };
}) {
  const { uow, clocks } = deps;
  const products = new PrismaProductRepository();
  const releases = new PrismaProductReleaseRepository();

  const catalog = new CatalogProductCatalog({
    resolveRelease: makeResolveRelease({ uow, products, releases }),
    getRelease: makeGetProductRelease({ uow, releases }),
    getProduct: makeGetProduct({ uow, products }),
    listProducts: makeListProducts({ uow, products }),
  });

  const workbookModels = makeWorkbookModels({
    uow,
    workbooks: new PrismaRaterWorkbookRepository(),
    storage: deps.storage,
  });

  const rater = makeRateTerm({
    rater: new RatingModuleQuoteRater(
      makeRateRisk({ models: workbookModels, extensions: deps.extensions.rater }),
    ),
    enricher: noEnrichment,
    clocks,
    catalog,
    extensions: deps.extensions.invoker,
  });

  const release = async (ctx: TenantContext, id: string): Promise<PolicyRelease> => {
    const r = await catalog.getRelease(ctx, id);

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

  const config: PolicyProductConfig = {
    release,
    publishedReleases: async (ctx, input) => {
      const listed = await makeListProductReleases({ uow, releases })(ctx, {
        productId: input.productId,
      });

      const ids = listed
        .filter((r) => sameJurisdiction(r.jurisdiction, input.jurisdiction))
        .toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .map((r) => r.id);

      return Promise.all(ids.map((id) => release(ctx, id)));
    },
  };

  const policyClients = makeGetPolicyClients({
    uow,
    accounts: new PrismaClientAccountRepository(),
    parties: new PrismaPolicyPartyRepository(),
    users: new PrismaClientUserRepository(),
  });

  const emails = async (ctx: TenantContext, policyId: string) =>
    (await policyClients(ctx, { policyId })).flatMap((c) => c.emails.map((e) => e.address));

  const branding = async (ctx: TenantContext) => {
    const profile = await deps.getProfile(ctx);

    return {
      name: profile.displayName,
      primaryColor: profile.primaryColor,
      ...(profile.supportEmail && { supportEmail: profile.supportEmail }),
      ...(profile.supportPhone && { supportPhone: profile.supportPhone }),
    };
  };

  return {
    emails,
    catalog,
    changes: {
      uow,
      outbox: deps.outbox,
      policies: deps.policies,
      invoices: deps.invoices,
      config,
      rater,
      clocks,
      storage: deps.storage,
      notices: new ReactPdfNoticeDocuments({
        branding,
        jurisdictionName,
        extensions: deps.extensions.invoker,
      }),
      billing: deps.billing,
      extensions: deps.extensions.invoker,
      delivery: new PortNoticeDelivery({
        emails,
        sendEmail: deps.sendEmail,
        sendLetter: deps.sendLetter,
        // Tenant profiles have no postal address yet; real print & mail needs one (TODO.md).
        returnAddress: async (ctx) => ({
          name: (await deps.getProfile(ctx)).displayName,
          line1: "",
          city: "",
          region: "",
          postalCode: "",
          country: "US",
        }),
      }),
    },
  };
}

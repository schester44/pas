import { composeAddresses } from "@pas/addresses/infrastructure";
import { makeApplyPayment, makeEnrollAutopay } from "@pas/billing";
import {
  carrierFeedWorkflow,
  carrierFlowWorkflow,
  type CarrierOutcome,
  type FlowCompletion,
} from "@pas/carriers";
import { carrierGateways, composeCarriers, feedSourceFrom } from "@pas/carriers/infrastructure";
import { makeListProductReleases, makeListProducts } from "@pas/catalog";
import {
  PrismaProductReleaseRepository,
  PrismaProductRepository,
} from "@pas/catalog/infrastructure";
import type { PrismaClient } from "@pas/db";
import { makeProducerOfRecord } from "@pas/distribution";
import {
  PrismaAgencyRepository,
  PrismaCommissionRepository,
  PrismaProducerRepository,
} from "@pas/distribution/infrastructure";
import { makeGetFormEditionFile } from "@pas/form-library";
import { PrismaFormEditionRepository } from "@pas/form-library/infrastructure";
import { AesSecretBox, type Integrations } from "@pas/integrations/infrastructure";
import {
  defineWorkflow,
  type ClockProvider,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type Workflows,
} from "@pas/kernel";
import type { Logger } from "@pas/observability";
import { makeLinkPolicyInsureds } from "@pas/parties";
import {
  PrismaClientAccountRepository,
  PrismaPolicyPartyRepository,
} from "@pas/parties/infrastructure";
import {
  makeAttachPolicyDocuments,
  makeCompleteCarrierTransaction,
  makeGetPolicy,
  makeIssueNewBusiness,
  makeListPolicies,
  type InvoiceIssuer,
  type PolicyRepository,
} from "@pas/policy";
import type { ObjectStorage } from "@pas/storage";
import {
  makeApplyCarrierQuote,
  makeContinueCarrierBind,
  type ProductCatalog,
  QuoteJourney,
} from "@pas/submissions";
import {
  PrismaQuoteRepository,
  PrismaSubmissionRepository,
  ReactPdfQuoteDocuments,
} from "@pas/submissions/infrastructure";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import type { composePolicyServices } from "./policy-services";

const failed = (error: string | null): CarrierOutcome => ({
  status: "failed",
  documents: [],
  messages: [{ text: error ?? "The carrier flow failed" }],
});

/**
 * Carriers in the worker (PLAN §12): the `carrier.flow` and `carrier.feed` workflows, and what
 * a finished flow does to the quote, the carrier-owned bind or the policy change that started it.
 */
export function composeWorkerCarriers(deps: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  policies: PolicyRepository;
  invoices: InvoiceIssuer;
  integrations: Integrations;
  policyServices: ReturnType<typeof composePolicyServices>;
  applyBillingEvent: Parameters<typeof makeApplyPayment>[0]["applyEvent"];
  schedules: Parameters<typeof makeEnrollAutopay>[0]["schedules"];
  branding: (ctx: TenantContext) => Promise<{
    name: string;
    primaryColor: string;
    supportEmail?: string;
    supportPhone?: string;
  }>;
  senderName: (ctx: TenantContext) => Promise<string>;
  workflows: () => Workflows;
  logger: Logger;
}) {
  const { uow, outbox, clocks, storage, integrations } = deps;
  const catalog: ProductCatalog = deps.policyServices.catalog;
  const releases = new PrismaProductReleaseRepository();
  const listPolicies = makeListPolicies({ uow, policies: deps.policies });
  const getPolicy = makeGetPolicy({ uow, policies: deps.policies, storage });

  const carriers = composeCarriers({
    prisma: deps.prisma,
    uow,
    clocks,
    storage,
    secrets: new AesSecretBox(process.env.INTEGRATIONS_SECRET_KEY),
    isSandbox: (ctx) => integrations.resolver.isSandbox(ctx.tenantId),
    workflows: deps.workflows,
    publicUrl: process.env.PUBLIC_API_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:4000",
    sendEmail: async (ctx, message) => {
      await (await integrations.resolver.port("email").for(ctx)).send(message);
    },
    senderName: deps.senderName,
    feedSource: feedSourceFrom({
      products: makeListProducts({ uow, products: new PrismaProductRepository() }),
      releases: (ctx, productId) => makeListProductReleases({ uow, releases })(ctx, { productId }),
      release: (ctx, id) => catalog.getRelease(ctx, id),
      policies: (ctx, scope) => listPolicies(ctx, scope, { limit: 1000 }),
      policy: (ctx, scope, id) => getPolicy.detail(ctx, scope, { id }),
    }),
  });

  const { gateway, transactions } = carrierGateways(carriers);
  const quotes = new PrismaQuoteRepository();
  const submissions = new PrismaSubmissionRepository();

  const lazyWorkflows: Workflows = {
    start: (...args) => deps.workflows().start(...args),
    signal: (...args) => deps.workflows().signal(...args),
    cancel: (...args) => deps.workflows().cancel(...args),
    status: (...args) => deps.workflows().status(...args),
  };

  const journey = new QuoteJourney(lazyWorkflows);

  const distribution = {
    uow,
    agencies: new PrismaAgencyRepository(),
    producers: new PrismaProducerRepository(),
    commissions: new PrismaCommissionRepository(),
    clocks,
  };

  const producerOfRecord = makeProducerOfRecord(distribution);

  const issueNewBusiness = makeIssueNewBusiness({
    uow,
    outbox,
    policies: deps.policies,
    invoices: deps.invoices,
    parties: {
      linkInsureds: makeLinkPolicyInsureds({
        accounts: new PrismaClientAccountRepository(),
        parties: new PrismaPolicyPartyRepository(),
        outbox,
        clocks,
      }),
    },
    clocks,
  });

  const applyPayment = makeApplyPayment({ applyEvent: deps.applyBillingEvent, clocks });

  const addresses = composeAddresses({
    uow,
    clocks,
    providers: {
      for: async (ctx) => (await integrations.resolver.chain(ctx, "address")).map((p) => p.adapter),
    },
    isSandbox: (ctx) => integrations.resolver.isSandbox(ctx.tenantId),
  });

  const continueBind = makeContinueCarrierBind({
    uow,
    outbox,
    quotes,
    submissions,
    catalog,
    payments: integrations.resolver.port("payments"),
    policies: {
      issue: async (ctx, request) => {
        const record = await producerOfRecord(ctx, {
          userId: request.producer.id,
          agencyId: request.producer.agencyId,
        });

        return issueNewBusiness(ctx, {
          ...(request as Parameters<typeof issueNewBusiness>[1]),
          producer: {
            ...request.producer,
            agencyId: record.agencyId,
            agencyName: record.agencyName,
          },
        });
      },
      attachDocuments: makeAttachPolicyDocuments({ uow, policies: deps.policies, clocks }),
      applyPayment: async (ctx, input) => {
        await applyPayment(ctx, input);
      },
      enrollAutopay: makeEnrollAutopay({
        uow,
        schedules: deps.schedules,
        applyEvent: deps.applyBillingEvent,
        clocks,
      }),
    },
    documents: new ReactPdfQuoteDocuments({
      formEdition: makeGetFormEditionFile({
        uow,
        editions: new PrismaFormEditionRepository(),
        storage,
      }),
      jurisdictionName,
      branding: deps.branding,
    }),
    storage,
    journey,
    clocks,
    addresses,
    carrier: gateway,
  });

  const applyQuote = makeApplyCarrierQuote({
    uow,
    outbox,
    quotes,
    submissions,
    catalog,
    carrier: gateway,
    clocks,
    journey,
  });

  const completeTransaction = makeCompleteCarrierTransaction({
    ...deps.policyServices.changes,
    carriers: transactions,
  });

  const complete: FlowCompletion = async (ctx, run) => {
    const outcome = run.output?.outcome ?? failed(run.error);
    const { subject } = run;

    switch (subject.kind) {
      case "quote": {
        const result = await applyQuote(ctx, { ...subject, outcome, error: run.error });

        deps.logger.info(
          { quoteId: subject.quoteId, outcome: outcome.status, ...result },
          "carrier quote",
        );

        return;
      }
      case "new_business": {
        const version = run.connectorVersionId
          ? await carriers.connector.get(ctx, { id: run.connectorVersionId })
          : null;

        const result = await continueBind(ctx, {
          quoteId: subject.quoteId,
          submissionId: subject.submissionId,
          phase: subject.phase,
          flowRunId: run.id,
          outcome,
          error: run.error,
          capabilities: version?.capabilities ?? [],
        });

        deps.logger.info(
          { quoteId: subject.quoteId, phase: subject.phase, ...result },
          "carrier bind",
        );

        return;
      }
      case "transaction": {
        const result = await completeTransaction(ctx, {
          policyId: subject.policyId,
          transactionId: subject.transactionId,
          flowRunId: run.id,
          outcome,
          error: run.error,
        });

        deps.logger.info(
          { transactionId: subject.transactionId, ...result },
          "carrier transaction",
        );

        return;
      }
      case "test":
        return;
    }
  };

  const executeFlow = carriers.executeFlow(complete);

  const flowWorkflow = defineWorkflow(
    carrierFlowWorkflow,
    ({ input, tenantId, runId, step }) =>
      executeFlow({ flowRunId: input.flowRunId, tenantId, runId, step }),
    { retries: 3 },
  );

  const feedWorkflow = defineWorkflow(carrierFeedWorkflow, async ({ input, tenantId, step }) => {
    const ctx: TenantContext = { tenantId, actor: { type: "system", process: "carrier.feed" } };

    for (let round = 0; round < 400; round++) {
      const wait = await step.run(`schedule-${round}`, () => carriers.feeds.schedule(ctx, input));

      if (!wait) return { rounds: round };

      await step.delay(`wait-${round}`, wait);

      await step.run(`deliver-${round}`, async () => {
        const result = await carriers.feeds.run(ctx, input);

        deps.logger.info({ feedId: input.feedId, ...result }, "carrier feed delivered");

        return result;
      });
    }

    return { rounds: 400 };
  });

  return { carriers, workflows: [flowWorkflow, feedWorkflow] };
}

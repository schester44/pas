import { composeAgencyDownloads } from "@pas/agency-downloads/infrastructure";
import { makeGetProduct, makeListProducts } from "@pas/catalog";
import { PrismaProductRepository } from "@pas/catalog/infrastructure";
import type { TrackObligations } from "@pas/compliance";
import { makeAgencyStatement, makeManageAgencies } from "@pas/distribution";
import {
  PrismaAgencyRepository,
  PrismaCommissionRepository,
  PrismaProducerRepository,
} from "@pas/distribution/infrastructure";
import { agencyDownloadChannelsFrom, type Integrations } from "@pas/integrations/infrastructure";
import {
  asId,
  type ClockProvider,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type Workflows,
} from "@pas/kernel";
import type { Logger } from "@pas/observability";
import {
  makeGetPolicy,
  makeGetTransactionFacts,
  makeGetTransactionFinancials,
  type PolicyRepository,
} from "@pas/policy";
import type { ObjectStorage } from "@pas/storage";
import type { DomainEventHandler } from "./handlers/domain-events";
import { makeNightlyBatchWorkflow } from "./workflows/agency-downloads";

const contextOf = (tenantId: string): TenantContext => ({
  tenantId: asId(tenantId),
  actor: { type: "system", process: "agency_downloads" },
});

/** Agency downloads in the worker: capture issued transactions and run the nightly batches. */
export function composeWorkerAgencyDownloads(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  policies: PolicyRepository;
  integrations: Integrations;
  tracked: TrackObligations;
  tenantName: (ctx: TenantContext) => Promise<string>;
  workflows: () => Workflows;
  logger: Logger;
}) {
  const { uow, clocks } = deps;
  const products = new PrismaProductRepository();

  const distribution = {
    uow,
    agencies: new PrismaAgencyRepository(),
    producers: new PrismaProducerRepository(),
    commissions: new PrismaCommissionRepository(),
    clocks,
  };

  const downloads = composeAgencyDownloads({
    ...deps,
    channels: agencyDownloadChannelsFrom(deps.integrations),
    policy: {
      facts: makeGetTransactionFacts({ uow, policies: deps.policies }),
      financials: makeGetTransactionFinancials({ uow, policies: deps.policies }),
      policies: makeGetPolicy({ uow, policies: deps.policies, storage: deps.storage }),
      products: {
        get: makeGetProduct({ uow, products }),
        list: makeListProducts({ uow, products }),
      },
    },
    agencies: makeManageAgencies(distribution),
    statements: makeAgencyStatement(distribution),
    obligations: deps.tracked,
  });

  return {
    downloads,
    workflows: [makeNightlyBatchWorkflow({ nightly: downloads.nightly })],
    handlers: (): Record<string, DomainEventHandler[]> => ({
      "policy.transaction_issued": [
        async (event) => {
          const { policyId, transactionId } = event.payload as {
            policyId: string;
            transactionId: string;
          };

          const ctx = contextOf(event.tenantId);
          const result = await downloads.capture(ctx, { policyId, transactionId });

          if (result.status === "queued") {
            await downloads.nightly.schedule(ctx, { runDate: result.runDate });
            deps.logger.info({ transactionId, ...result }, "agency download queued");
          }
        },
      ],
      "integrations.install_changed": [
        async (event) => {
          await downloads.nightly.schedule(contextOf(event.tenantId));
        },
      ],
    }),
  };
}

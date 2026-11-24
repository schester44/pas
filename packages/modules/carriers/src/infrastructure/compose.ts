import type { PrismaClient } from "@pas/db";
import type { ClockProvider, TenantContext, UnitOfWork, Workflows } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { makeCarrierServices } from "../application/carrier-services";
import type { CarrierDeps } from "../application/deps";
import { type FlowCompletion, makeExecuteFlow } from "../application/execute-flow";
import { makeFeeds } from "../application/feeds";
import { makeFlowRuns } from "../application/flow-runs";
import { makeManageCarriers } from "../application/manage-carriers";
import { makeManageConnector } from "../application/manage-connector";
import { makeReceiveCallback } from "../application/receive-callback";
import { makeStartFlow } from "../application/start-flow";
import type { FeedSource, HttpTransport, SecretBox } from "../ports/services";
import { FeedDeliveryChannels } from "./adapters";
import { MemoryTokenCache, NodeHttpTransport } from "./node-http-transport";
import { PrismaCarrierRepository, PrismaConnectionLocator } from "./prisma-carrier-repository";
import { PrismaConnectorRepository } from "./prisma-connector-repository";
import {
  PrismaCallbackInbox,
  PrismaFeedRepository,
  PrismaFlowRunRepository,
  PrismaPolicyLinkRepository,
} from "./prisma-flow-run-repository";

export interface CarrierCompositionDeps {
  prisma: PrismaClient;
  uow: UnitOfWork;
  clocks: ClockProvider;
  storage: ObjectStorage;
  secrets: SecretBox;
  isSandbox: (ctx: TenantContext) => Promise<boolean>;
  workflows: () => Workflows;
  publicUrl: string;
  feedSource: FeedSource;
  sendEmail: (
    ctx: TenantContext,
    message: { to: string; subject: string; text: string; tag: string },
  ) => Promise<void>;
  senderName: (ctx: TenantContext) => Promise<string>;
  http?: HttpTransport;
}

const now = () => new Date();

export function composeCarriers(input: CarrierCompositionDeps) {
  const deps: CarrierDeps = {
    uow: input.uow,
    clocks: input.clocks,
    carriers: new PrismaCarrierRepository(),
    connectors: new PrismaConnectorRepository(),
    runs: new PrismaFlowRunRepository(),
    callbacks: new PrismaCallbackInbox(now),
    locator: new PrismaConnectionLocator(input.prisma),
    links: new PrismaPolicyLinkRepository(now),
    feeds: new PrismaFeedRepository(),
    secrets: input.secrets,
    http: input.http ?? new NodeHttpTransport(),
    tokens: new MemoryTokenCache(),
    environments: { isSandbox: input.isSandbox },
    storage: input.storage,
    feedSource: input.feedSource,
    feedChannels: new FeedDeliveryChannels({ storage: input.storage, sendEmail: input.sendEmail }),
    workflows: input.workflows,
    publicUrl: input.publicUrl,
  };

  return {
    deps,
    manage: makeManageCarriers(deps),
    connector: makeManageConnector(deps),
    startFlow: makeStartFlow(deps),
    runs: makeFlowRuns(deps),
    receiveCallback: makeReceiveCallback(deps),
    services: makeCarrierServices(deps),
    feeds: makeFeeds({ ...deps, senderName: input.senderName }),
    executeFlow: (complete: FlowCompletion) => makeExecuteFlow(deps, complete),
  };
}

export type Carriers = ReturnType<typeof composeCarriers>;

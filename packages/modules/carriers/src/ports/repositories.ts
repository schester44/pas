import type { TenantContext, Transaction } from "@pas/kernel";
import type { Carrier } from "../domain/carrier";
import type { CarrierConnection } from "../domain/connection";
import type { ConnectorVersion } from "../domain/connector-version";
import type { Feed, FeedDelivery } from "../domain/feed";
import type { Fixture } from "../domain/fixture";
import type { Exchange, FlowRun } from "../domain/flow-run";

export interface CarrierRepository {
  list(tx: Transaction, ctx: TenantContext): Promise<Carrier[]>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Carrier | null>;
  findByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<Carrier | null>;
  save(tx: Transaction, carrier: Carrier): Promise<void>;
  connections(tx: Transaction, ctx: TenantContext, carrierId: string): Promise<CarrierConnection[]>;
  findConnection(
    tx: Transaction,
    ctx: TenantContext,
    id: string,
  ): Promise<CarrierConnection | null>;
  saveConnection(tx: Transaction, connection: CarrierConnection): Promise<void>;
}

export interface ConnectorRepository {
  versions(tx: Transaction, ctx: TenantContext, carrierId: string): Promise<ConnectorVersion[]>;
  findVersion(tx: Transaction, ctx: TenantContext, id: string): Promise<ConnectorVersion | null>;
  latestPublished(
    tx: Transaction,
    ctx: TenantContext,
    carrierId: string,
  ): Promise<ConnectorVersion | null>;
  saveVersion(tx: Transaction, version: ConnectorVersion): Promise<void>;
  fixtures(tx: Transaction, ctx: TenantContext, carrierId: string): Promise<Fixture[]>;
  saveFixture(tx: Transaction, ctx: TenantContext, fixture: Fixture): Promise<void>;
  deleteFixture(tx: Transaction, ctx: TenantContext, id: string): Promise<void>;
}

export interface FlowRunRepository {
  save(tx: Transaction, run: FlowRun): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<FlowRun | null>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { carrierId?: string; subjectKey?: { field: string; value: string }; limit: number },
  ): Promise<FlowRun[]>;
  record(tx: Transaction, ctx: TenantContext, exchange: Exchange): Promise<void>;
  exchanges(tx: Transaction, ctx: TenantContext, flowRunId: string): Promise<Exchange[]>;
}

export interface PendingCallback {
  tenantId: string;
  connectionId: string;
  correlation: string;
  workflowRunId: string | null;
  event: string | null;
  payload: unknown;
  signalled: boolean;
}

/** Pairs inbound callbacks with the run waiting on their key, whichever arrives first. */
export interface CallbackInbox {
  expect(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      connectionId: string;
      correlation: string;
      flowRunId: string;
      workflowRunId: string;
      event: string;
    },
  ): Promise<PendingCallback>;
  receive(
    tx: Transaction,
    ctx: TenantContext,
    input: { connectionId: string; correlation: string; payload: unknown },
  ): Promise<PendingCallback>;
  markSignalled(
    tx: Transaction,
    ctx: TenantContext,
    input: { connectionId: string; correlation: string },
  ): Promise<void>;
}

/** Platform-level: an inbound callback names only its connection. */
export interface ConnectionLocator {
  tenantOf(connectionId: string): Promise<string | null>;
}

export interface PolicyLink {
  carrierId: string;
  policyId: string;
  quoteId: string | null;
  carrierPolicyNumber: string | null;
  carrierReference: string | null;
  status: string | null;
}

export interface PolicyLinkRepository {
  find(tx: Transaction, ctx: TenantContext, policyId: string): Promise<PolicyLink | null>;
  save(tx: Transaction, ctx: TenantContext, link: PolicyLink): Promise<void>;
}

export interface FeedRepository {
  list(tx: Transaction, ctx: TenantContext, carrierId: string): Promise<Feed[]>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Feed | null>;
  save(tx: Transaction, ctx: TenantContext, feed: Feed): Promise<void>;
  deliveries(
    tx: Transaction,
    ctx: TenantContext,
    feedId: string,
    limit: number,
  ): Promise<FeedDelivery[]>;
  recordDelivery(tx: Transaction, ctx: TenantContext, delivery: FeedDelivery): Promise<void>;
}

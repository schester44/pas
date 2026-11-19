import {
  instantFromDb,
  instantToDb,
  jsonToDb,
  plainDateFromDb,
  plainDateToDb,
  prismaTx,
} from "@pas/db";
import type {
  CarrierCallback as CallbackRow,
  CarrierExchange as ExchangeRow,
  CarrierFeed as FeedRow,
  CarrierFeedDelivery as DeliveryRow,
  CarrierFlowRun as RunRow,
} from "@pas/db/client";
import { asId, newId, type TenantContext, type Transaction } from "@pas/kernel";
import type { Feed, FeedDelivery } from "../domain/feed";
import type { Exchange, FlowRun } from "../domain/flow-run";
import type {
  CallbackInbox,
  FeedRepository,
  FlowRunRepository,
  PendingCallback,
  PolicyLink,
  PolicyLinkRepository,
} from "../ports/repositories";

const toRun = (row: RunRow): FlowRun => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  carrierId: asId(row.carrierId),
  connectionId: row.connectionId,
  connectorVersionId: row.connectorVersionId,
  connectorVersion: row.connectorVersion,
  capability: row.capability as FlowRun["capability"],
  subject: row.subject as unknown as FlowRun["subject"],
  mode: row.mode as FlowRun["mode"],
  environment: row.environment as FlowRun["environment"],
  status: row.status as FlowRun["status"],
  input: row.input as unknown as FlowRun["input"],
  output: row.output as unknown as FlowRun["output"],
  error: row.error,
  workflowRunId: row.workflowRunId,
  startedAt: instantFromDb(row.startedAt),
  updatedAt: instantFromDb(row.updatedAt),
  completedAt: row.completedAt ? instantFromDb(row.completedAt) : null,
});

const toExchange = (row: ExchangeRow): Exchange => ({
  id: row.id,
  flowRunId: row.flowRunId,
  execId: row.execId,
  stepId: row.stepId,
  kind: row.kind as Exchange["kind"],
  attempt: row.attempt,
  request: row.request as Exchange["request"],
  response: row.response as Exchange["response"],
  ok: row.ok,
  error: row.error,
  durationMs: row.durationMs,
  occurredAt: instantFromDb(row.occurredAt),
});

export class PrismaFlowRunRepository implements FlowRunRepository {
  async save(tx: Transaction, run: FlowRun) {
    const data = {
      status: run.status,
      output: run.output ? jsonToDb(run.output) : undefined,
      error: run.error,
      workflowRunId: run.workflowRunId,
      updatedAt: instantToDb(run.updatedAt),
      completedAt: run.completedAt ? instantToDb(run.completedAt) : null,
    };

    await prismaTx(tx).carrierFlowRun.upsert({
      where: { id: run.id },
      create: {
        id: run.id,
        tenantId: run.tenantId,
        carrierId: run.carrierId,
        connectionId: run.connectionId,
        connectorVersionId: run.connectorVersionId,
        connectorVersion: run.connectorVersion,
        capability: run.capability,
        subject: jsonToDb(run.subject),
        mode: run.mode,
        environment: run.environment,
        input: jsonToDb(run.input),
        startedAt: instantToDb(run.startedAt),
        ...data,
      },
      update: data,
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

    const row = await prismaTx(tx).carrierFlowRun.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toRun(row);
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { carrierId?: string; subjectKey?: { field: string; value: string }; limit: number },
  ) {
    const rows = await prismaTx(tx).carrierFlowRun.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.carrierId && { carrierId: filter.carrierId }),
        ...(filter.subjectKey && {
          subject: { path: [filter.subjectKey.field], equals: filter.subjectKey.value },
        }),
      },
      orderBy: { startedAt: "desc" },
      take: filter.limit,
    });

    return rows.map(toRun);
  }

  async record(tx: Transaction, ctx: TenantContext, exchange: Exchange) {
    await prismaTx(tx).carrierExchange.upsert({
      where: { flowRunId_execId: { flowRunId: exchange.flowRunId, execId: exchange.execId } },
      create: {
        id: exchange.id,
        tenantId: ctx.tenantId,
        flowRunId: exchange.flowRunId,
        execId: exchange.execId,
        stepId: exchange.stepId,
        kind: exchange.kind,
        attempt: exchange.attempt,
        request: jsonToDb(exchange.request),
        response: exchange.response ? jsonToDb(exchange.response) : undefined,
        ok: exchange.ok,
        error: exchange.error,
        durationMs: Math.round(exchange.durationMs),
        occurredAt: instantToDb(exchange.occurredAt),
      },
      update: {},
    });
  }

  async exchanges(tx: Transaction, ctx: TenantContext, flowRunId: string) {
    const rows = await prismaTx(tx).carrierExchange.findMany({
      where: { tenantId: ctx.tenantId, flowRunId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });

    return rows.map(toExchange);
  }
}

const toPending = (row: CallbackRow): PendingCallback => ({
  tenantId: row.tenantId,
  connectionId: row.connectionId,
  correlation: row.correlation,
  workflowRunId: row.workflowRunId,
  event: row.event,
  payload: row.payload,
  signalled: row.signalledAt !== null,
});

export class PrismaCallbackInbox implements CallbackInbox {
  constructor(private readonly now: () => Date) {}

  async expect(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      connectionId: string;
      correlation: string;
      flowRunId: string;
      workflowRunId: string;
      event: string;
    },
  ) {
    const key = {
      tenantId: ctx.tenantId,
      connectionId: input.connectionId,
      correlation: input.correlation,
    };

    const row = await prismaTx(tx).carrierCallback.upsert({
      where: { tenantId_connectionId_correlation: key },
      create: {
        id: newId(),
        ...key,
        flowRunId: input.flowRunId,
        workflowRunId: input.workflowRunId,
        event: input.event,
        createdAt: this.now(),
      },
      update: {
        flowRunId: input.flowRunId,
        workflowRunId: input.workflowRunId,
        event: input.event,
        signalledAt: null,
      },
    });

    return toPending(row);
  }

  async receive(
    tx: Transaction,
    ctx: TenantContext,
    input: { connectionId: string; correlation: string; payload: unknown },
  ) {
    const key = {
      tenantId: ctx.tenantId,
      connectionId: input.connectionId,
      correlation: input.correlation,
    };

    const row = await prismaTx(tx).carrierCallback.upsert({
      where: { tenantId_connectionId_correlation: key },
      create: {
        id: newId(),
        ...key,
        payload: jsonToDb(input.payload),
        receivedAt: this.now(),
        createdAt: this.now(),
      },
      update: { payload: jsonToDb(input.payload), receivedAt: this.now() },
    });

    return toPending(row);
  }

  async markSignalled(
    tx: Transaction,
    ctx: TenantContext,
    input: { connectionId: string; correlation: string },
  ) {
    await prismaTx(tx).carrierCallback.updateMany({
      where: {
        tenantId: ctx.tenantId,
        connectionId: input.connectionId,
        correlation: input.correlation,
      },
      data: { signalledAt: this.now() },
    });
  }
}

export class PrismaPolicyLinkRepository implements PolicyLinkRepository {
  constructor(private readonly now: () => Date) {}

  async find(tx: Transaction, ctx: TenantContext, policyId: string): Promise<PolicyLink | null> {
    const row = await prismaTx(tx).carrierPolicyLink.findFirst({
      where: { tenantId: ctx.tenantId, policyId },
    });

    return (
      row && {
        carrierId: row.carrierId,
        policyId: row.policyId,
        quoteId: row.quoteId,
        carrierPolicyNumber: row.carrierPolicyNumber,
        carrierReference: row.carrierReference,
        status: row.status,
      }
    );
  }

  async save(tx: Transaction, ctx: TenantContext, link: PolicyLink) {
    const data = {
      carrierId: link.carrierId,
      quoteId: link.quoteId,
      carrierPolicyNumber: link.carrierPolicyNumber,
      carrierReference: link.carrierReference,
      status: link.status,
      updatedAt: this.now(),
    };

    await prismaTx(tx).carrierPolicyLink.upsert({
      where: { tenantId_policyId: { tenantId: ctx.tenantId, policyId: link.policyId } },
      create: {
        id: newId(),
        tenantId: ctx.tenantId,
        policyId: link.policyId,
        createdAt: this.now(),
        ...data,
      },
      update: data,
    });
  }
}

const toFeed = (row: FeedRow): Feed => ({
  id: row.id,
  carrierId: row.carrierId,
  name: row.name,
  format: row.format as Feed["format"],
  channel: row.channel as Feed["channel"],
  destination: row.destination as Feed["destination"],
  schedule: row.schedule as Feed["schedule"],
  status: row.status as Feed["status"],
  lastRunAt: row.lastRunAt ? instantFromDb(row.lastRunAt) : null,
  createdAt: instantFromDb(row.createdAt),
  updatedAt: instantFromDb(row.updatedAt),
});

const toDelivery = (row: DeliveryRow): FeedDelivery => ({
  id: row.id,
  feedId: row.feedId,
  periodFrom: plainDateFromDb(row.periodFrom),
  periodTo: plainDateFromDb(row.periodTo),
  status: row.status as FeedDelivery["status"],
  fileName: row.fileName,
  storageKey: row.storageKey,
  records: row.records,
  bytes: row.bytes,
  channel: row.channel as FeedDelivery["channel"],
  detail: row.detail,
  deliveredAt: instantFromDb(row.deliveredAt),
});

export class PrismaFeedRepository implements FeedRepository {
  async list(tx: Transaction, ctx: TenantContext, carrierId: string) {
    const rows = await prismaTx(tx).carrierFeed.findMany({
      where: { tenantId: ctx.tenantId, carrierId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toFeed);
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

    const row = await prismaTx(tx).carrierFeed.findFirst({ where: { tenantId: ctx.tenantId, id } });

    return row && toFeed(row);
  }

  async save(tx: Transaction, ctx: TenantContext, feed: Feed) {
    const data = {
      name: feed.name,
      format: feed.format,
      channel: feed.channel,
      destination: jsonToDb(feed.destination),
      schedule: feed.schedule,
      status: feed.status,
      lastRunAt: feed.lastRunAt ? instantToDb(feed.lastRunAt) : null,
      updatedAt: instantToDb(feed.updatedAt),
    };

    await prismaTx(tx).carrierFeed.upsert({
      where: { id: feed.id },
      create: {
        id: feed.id,
        tenantId: ctx.tenantId,
        carrierId: feed.carrierId,
        createdAt: instantToDb(feed.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async deliveries(tx: Transaction, ctx: TenantContext, feedId: string, limit: number) {
    const rows = await prismaTx(tx).carrierFeedDelivery.findMany({
      where: { tenantId: ctx.tenantId, feedId },
      orderBy: { deliveredAt: "desc" },
      take: limit,
    });

    return rows.map(toDelivery);
  }

  async recordDelivery(tx: Transaction, ctx: TenantContext, delivery: FeedDelivery) {
    await prismaTx(tx).carrierFeedDelivery.create({
      data: {
        id: delivery.id,
        tenantId: ctx.tenantId,
        feedId: delivery.feedId,
        periodFrom: plainDateToDb(delivery.periodFrom),
        periodTo: plainDateToDb(delivery.periodTo),
        status: delivery.status,
        fileName: delivery.fileName,
        storageKey: delivery.storageKey,
        records: delivery.records,
        bytes: delivery.bytes,
        channel: delivery.channel,
        detail: delivery.detail,
        deliveredAt: instantToDb(delivery.deliveredAt),
      },
    });
  }
}

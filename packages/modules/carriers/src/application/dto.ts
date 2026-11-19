import type { Carrier } from "../domain/carrier";
import type { CarrierConnection } from "../domain/connection";
import { capabilitiesOf } from "../domain/connector";
import type { ConnectorVersion } from "../domain/connector-version";
import type { Feed, FeedDelivery } from "../domain/feed";
import type { Fixture } from "../domain/fixture";
import type { Exchange, FlowRun } from "../domain/flow-run";

export function toCarrierDto(carrier: Carrier) {
  return {
    id: carrier.id,
    key: carrier.key,
    name: carrier.name,
    naic: carrier.naic,
    amBest: carrier.amBest,
    admitted: carrier.admitted,
    lines: carrier.lines,
    mode: carrier.mode,
    extensionKey: carrier.extensionKey,
    activeEnvironment: carrier.activeEnvironment,
    status: carrier.status,
    createdAt: carrier.createdAt.toString(),
    updatedAt: carrier.updatedAt.toString(),
  };
}

export type CarrierDto = ReturnType<typeof toCarrierDto>;

export function toConnectionDto(connection: CarrierConnection, publicUrl: string) {
  return {
    id: connection.id,
    environment: connection.environment,
    baseUrl: connection.baseUrl,
    auth: connection.auth,
    secretHints: connection.secretHints,
    callback: connection.callback,
    callbackUrl: `${publicUrl.replace(/\/+$/, "")}/api/carriers/callbacks/${connection.id}`,
    updatedAt: connection.updatedAt.toString(),
  };
}

export type ConnectionDto = ReturnType<typeof toConnectionDto>;

export function toVersionDto(version: ConnectorVersion) {
  return {
    id: version.id,
    version: version.version,
    status: version.status,
    definition: version.definition,
    capabilities: capabilitiesOf(version.definition),
    contentHash: version.contentHash,
    testReport: version.testReport,
    note: version.note,
    createdAt: version.createdAt.toString(),
    updatedAt: version.updatedAt.toString(),
    publishedAt: version.publishedAt?.toString() ?? null,
  };
}

export type ConnectorVersionDto = ReturnType<typeof toVersionDto>;

export function toFixtureDto(fixture: Fixture) {
  return {
    id: fixture.id,
    capability: fixture.capability,
    name: fixture.name,
    exchanges: fixture.exchanges.length,
    callbacks: fixture.callbacks.length,
    expected: fixture.expected,
    createdAt: fixture.createdAt.toString(),
  };
}

export function toRunDto(run: FlowRun) {
  return {
    id: run.id,
    carrierId: run.carrierId,
    capability: run.capability,
    subject: run.subject,
    mode: run.mode,
    environment: run.environment,
    connectorVersionId: run.connectorVersionId,
    connectorVersion: run.connectorVersion,
    status: run.status,
    input: run.input,
    output: run.output,
    error: run.error,
    startedAt: run.startedAt.toString(),
    completedAt: run.completedAt?.toString() ?? null,
  };
}

export type FlowRunDto = ReturnType<typeof toRunDto>;

export function toExchangeDto(exchange: Exchange) {
  return {
    id: exchange.id,
    execId: exchange.execId,
    stepId: exchange.stepId,
    kind: exchange.kind,
    attempt: exchange.attempt,
    request: exchange.request,
    response: exchange.response,
    ok: exchange.ok,
    error: exchange.error,
    durationMs: exchange.durationMs,
    occurredAt: exchange.occurredAt.toString(),
  };
}

export type ExchangeDto = ReturnType<typeof toExchangeDto>;

export function toFeedDto(feed: Feed, deliveries: FeedDelivery[]) {
  return {
    id: feed.id,
    name: feed.name,
    format: feed.format,
    channel: feed.channel,
    destination: feed.destination,
    schedule: feed.schedule,
    status: feed.status,
    lastRunAt: feed.lastRunAt?.toString() ?? null,
    deliveries: deliveries.map((d) => ({
      id: d.id,
      periodFrom: d.periodFrom.toString(),
      periodTo: d.periodTo.toString(),
      status: d.status,
      fileName: d.fileName,
      records: d.records,
      bytes: d.bytes,
      channel: d.channel,
      detail: d.detail,
      deliveredAt: d.deliveredAt.toString(),
    })),
  };
}

export type FeedDto = ReturnType<typeof toFeedDto>;

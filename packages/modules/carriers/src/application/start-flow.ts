import { createHash } from "node:crypto";
import {
  asId,
  DomainError,
  invalid,
  notFound,
  type TenantContext,
  type Transaction,
  workflowRef,
} from "@pas/kernel";
import { type Carrier, environmentFor } from "../domain/carrier";
import type { CanonicalInput, FlowSubject } from "../domain/canonical";
import { CAPABILITY_LABELS, type Capability, capabilitiesOf } from "../domain/connector";
import type { ConnectorVersion } from "../domain/connector-version";
import type { FlowRun, FlowRunMode } from "../domain/flow-run";
import type { CarrierDeps } from "./deps";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One run per capability invocation; the handler is registered in apps/worker. */
export const carrierFlowWorkflow = workflowRef<{ flowRunId: string }>("carrier.flow", {
  parse(value) {
    const id = (value as { flowRunId?: unknown } | null)?.flowRunId;

    if (typeof id !== "string" || !UUID.test(id)) throw invalid("carrier.flow needs a flowRunId");

    return { flowRunId: id };
  },
});

/** Same key, same run: a retried start never opens a second carrier conversation. */
function runIdFor(tenantId: string, key: string): string {
  const hex = createHash("sha256").update(`${tenantId}:${key}`).digest("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface StartFlowInput {
  carrier: { key: string } | { id: string };
  capability: Capability;
  subject: FlowSubject;
  input: CanonicalInput;
  idempotencyKey: string;
  mode?: FlowRunMode;
  /** Test console: run this (possibly draft) connector version instead of the published one. */
  connectorVersionId?: string;
}

async function connectorFor(
  deps: Pick<CarrierDeps, "connectors">,
  tx: Transaction,
  ctx: TenantContext,
  carrier: Carrier,
  versionId: string | undefined,
): Promise<ConnectorVersion> {
  const version = versionId
    ? await deps.connectors.findVersion(tx, ctx, versionId)
    : await deps.connectors.latestPublished(tx, ctx, carrier.id);

  if (!version || version.carrierId !== carrier.id) {
    throw new DomainError("precondition_failed", `${carrier.name} has no published connector yet`, {
      reason: "no_connector",
    });
  }

  return version;
}

export function makeStartFlow(deps: CarrierDeps) {
  return async function startFlow(
    ctx: TenantContext,
    input: StartFlowInput,
  ): Promise<{ flowRunId: string }> {
    const mode = input.mode ?? "live";
    const sandbox = await deps.environments.isSandbox(ctx);
    const flowRunId = runIdFor(ctx.tenantId, input.idempotencyKey);

    const run = await deps.uow.run(ctx, async (tx) => {
      const existing = await deps.runs.findById(tx, ctx, flowRunId);

      if (existing) return existing;

      const carrier =
        "key" in input.carrier
          ? await deps.carriers.findByKey(tx, ctx, input.carrier.key)
          : await deps.carriers.findById(tx, ctx, input.carrier.id);

      if (!carrier)
        throw notFound("Carrier", "key" in input.carrier ? input.carrier.key : input.carrier.id);

      if (carrier.mode === "file_feed") {
        throw new DomainError(
          "precondition_failed",
          `${carrier.name} is connected by file feeds, so PAS handles this transaction and reports it`,
          { reason: "file_feed_carrier" },
        );
      }

      const environment = mode === "test" ? "test" : environmentFor(carrier, sandbox);

      const connection = (await deps.carriers.connections(tx, ctx, carrier.id)).find(
        (c) => c.environment === environment,
      );

      if (!connection) {
        throw new DomainError(
          "precondition_failed",
          `Set up ${carrier.name}'s ${environment} connection first`,
          {
            reason: "no_connection",
          },
        );
      }

      const version =
        carrier.mode === "connector"
          ? await connectorFor(deps, tx, ctx, carrier, input.connectorVersionId)
          : null;

      const supported = version
        ? capabilitiesOf(version.definition)
        : (deps.extensions.get(ctx.tenantId, carrier.extensionKey ?? "")?.capabilities ?? []);

      if (!supported.includes(input.capability)) {
        throw new DomainError(
          "precondition_failed",
          `${carrier.name}'s ${version ? "connector" : "extension"} doesn't support ${CAPABILITY_LABELS[input.capability].toLowerCase()}`,
          { reason: "capability_missing", capability: input.capability },
        );
      }

      const now = deps.clocks.forTenant(ctx.tenantId).now();

      const created: FlowRun = {
        id: asId(flowRunId),
        tenantId: ctx.tenantId,
        carrierId: carrier.id,
        connectionId: connection.id,
        connectorVersionId: version?.id ?? null,
        connectorVersion: version?.version ?? null,
        capability: input.capability,
        subject: input.subject,
        mode,
        environment,
        status: "running",
        input: input.input,
        output: null,
        error: null,
        workflowRunId: null,
        startedAt: now,
        updatedAt: now,
        completedAt: null,
      };

      await deps.runs.save(tx, created);

      return created;
    });

    await deps
      .workflows()
      .start(
        ctx,
        carrierFlowWorkflow,
        { flowRunId: run.id },
        { idempotencyKey: `carrier.flow:${run.id}` },
      );

    return { flowRunId: run.id };
  };
}

export type StartFlow = ReturnType<typeof makeStartFlow>;

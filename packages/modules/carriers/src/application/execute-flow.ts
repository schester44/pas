import {
  asId,
  newId,
  notFound,
  type TenantContext,
  type TenantId,
  type WorkflowStep,
} from "@pas/kernel";
import type { CarrierConnection } from "../domain/connection";
import type { ConnectorDefinition } from "../domain/connector";
import type { FlowRun, FlowRunOutput } from "../domain/flow-run";
import type { CarrierOutcome } from "../domain/outcome";
import type { ExchangeRecord, FlowIO } from "../ports/flow-io";
import { connectionClient } from "./connection-client";
import type { CarrierDeps } from "./deps";
import { toRunDto } from "./dto";
import { type FlowResult, runFlow } from "./run-flow";

/** Applies a finished run to whatever started it (a quote, a bind, a policy transaction). */
const INLINE_WAIT_SECONDS = 15;

export type FlowCompletion = (
  ctx: TenantContext,
  run: ReturnType<typeof toRunDto>,
) => Promise<void>;

const systemContext = (tenantId: TenantId): TenantContext => ({
  tenantId,
  actor: { type: "system", process: "carrier.flow" },
});

interface Plan {
  carrierId: string;
  connectionId: string;
  environment: string;
  baseUrl: string;
  definition: ConnectorDefinition | null;
}

export function callbackUrlFor(publicUrl: string, connectionId: string) {
  return `${publicUrl.replace(/\/+$/, "")}/api/carriers/callbacks/${connectionId}`;
}

const failedFlow = (message: string): FlowResult => ({
  status: "failed",
  outcome: { status: "failed", documents: [], messages: [{ text: message }] },
  error: message,
  failedStep: "connector",
  compensated: [],
  steps: {},
});

/** The body of the `carrier.flow` workflow: load, converse with the carrier, record, apply. */
export function makeExecuteFlow(deps: CarrierDeps, complete: FlowCompletion) {
  const update = (ctx: TenantContext, id: string, change: (run: FlowRun) => FlowRun) =>
    deps.uow.run(ctx, async (tx) => {
      const run = await deps.runs.findById(tx, ctx, id);

      if (!run) throw notFound("CarrierFlowRun", id);

      const next = { ...change(run), updatedAt: deps.clocks.forTenant(ctx.tenantId).now() };

      await deps.runs.save(tx, next);

      return next;
    });

  const flowIO = (
    ctx: TenantContext,
    flowRunId: string,
    workflowRunId: string,
    plan: Plan,
  ): FlowIO => {
    let connection: Promise<CarrierConnection> | undefined;

    const client = async () => {
      connection ??= deps.uow.run(ctx, async (tx) => {
        const found = await deps.carriers.findConnection(tx, ctx, plan.connectionId);

        if (!found) throw notFound("CarrierConnection", plan.connectionId);

        return found;
      });

      return connectionClient(deps, ctx, await connection);
    };

    return {
      send: async (request) => (await client()).send(request),
      record: async (exchange: ExchangeRecord) => {
        const { redact } = await client();
        const now = deps.clocks.forTenant(ctx.tenantId).now();

        await deps.uow.run(ctx, (tx) =>
          deps.runs.record(tx, ctx, {
            id: newId(),
            flowRunId,
            ...exchange,
            request: redact(exchange.request),
            response: redact(exchange.response),
            occurredAt: now,
          }),
        );
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      awaitCallback: async (correlation, event) => {
        const pending = await deps.uow.run(ctx, (tx) =>
          deps.callbacks.expect(tx, ctx, {
            connectionId: plan.connectionId,
            correlation,
            flowRunId,
            workflowRunId,
            event,
          }),
        );

        await update(ctx, flowRunId, (run) => ({ ...run, status: "waiting" }));

        if (pending.payload !== null && pending.payload !== undefined && !pending.signalled) {
          await deps.workflows().signal(ctx, workflowRunId, event, { body: pending.payload });

          await deps.uow.run(ctx, (tx) =>
            deps.callbacks.markSignalled(tx, ctx, { connectionId: plan.connectionId, correlation }),
          );
        }
      },
    };
  };

  return async function executeFlow(input: {
    flowRunId: string;
    tenantId: TenantId;
    runId: string;
    step: WorkflowStep;
  }): Promise<{ status: string; outcome: CarrierOutcome["status"] }> {
    const ctx = systemContext(asId(input.tenantId));
    const { step } = input;

    const plan = await step.run("load", () =>
      deps.uow.run(ctx, async (tx): Promise<Plan> => {
        const run = await deps.runs.findById(tx, ctx, input.flowRunId);

        if (!run) throw notFound("CarrierFlowRun", input.flowRunId);

        const connection = run.connectionId
          ? await deps.carriers.findConnection(tx, ctx, run.connectionId)
          : null;

        const carrier = await deps.carriers.findById(tx, ctx, run.carrierId);

        const version = run.connectorVersionId
          ? await deps.connectors.findVersion(tx, ctx, run.connectorVersionId)
          : null;

        if (!connection || !carrier) throw notFound("CarrierConnection", run.connectionId ?? "");

        await deps.runs.save(tx, {
          ...run,
          workflowRunId: input.runId,
          updatedAt: deps.clocks.forTenant(ctx.tenantId).now(),
        });

        return {
          carrierId: carrier.id,
          connectionId: connection.id,
          environment: connection.environment,
          baseUrl: connection.baseUrl,
          definition: version?.definition ?? null,
        };
      }),
    );

    const run = await deps.uow.run(
      ctx,
      async (tx) => (await deps.runs.findById(tx, ctx, input.flowRunId))!,
    );

    const io = flowIO(ctx, run.id, input.runId, plan);
    const flow = plan.definition?.capabilities[run.capability];

    const result: FlowResult =
      plan.definition && flow
        ? await runFlow(step, io, {
            definition: plan.definition,
            flow,
            input: run.input as unknown as Record<string, unknown>,
            connection: { environment: plan.environment, baseUrl: plan.baseUrl },
            callbackUrl: callbackUrlFor(deps.publicUrl, plan.connectionId),
            runId: run.id,
            inlineWaitSeconds: INLINE_WAIT_SECONDS,
          })
        : failedFlow(`The connector has no ${run.capability} flow`);

    const finished = await step.run("finish", async () => {
      const connection = await deps.uow.run(ctx, (tx) =>
        deps.carriers.findConnection(tx, ctx, plan.connectionId),
      );

      const output: FlowRunOutput = {
        outcome: result.outcome,
        failedStep: result.failedStep,
        compensated: result.compensated,
        steps: connection ? connectionClient(deps, ctx, connection).redact(result.steps) : {},
      };

      const saved = await update(ctx, run.id, (current) => ({
        ...current,
        status: result.status,
        output,
        error: result.error,
        completedAt: deps.clocks.forTenant(ctx.tenantId).now(),
      }));

      return toRunDto(saved);
    });

    await step.run("apply", async () => {
      await complete(ctx, finished);

      return true;
    });

    return { status: finished.status, outcome: result.outcome.status };
  };
}

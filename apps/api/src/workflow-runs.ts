import { conflict, type TenantContext, type WorkflowRunStatus, workflowSubject } from "@pas/kernel";
import { type QueueClient, reconciliationQueue } from "@pas/queues";
import type { Search } from "@pas/search";
import type { TenantClocks } from "@pas/tenants/infrastructure";
import type { PostgresWorkflows, WorkflowRunSummary } from "@pas/workflows";
import type { DescribeRun } from "./sandbox-timers";

export interface RunListInput {
  workflowId?: string;
  status?: WorkflowRunStatus;
  subject?: string;
  q?: string;
  before?: Temporal.Instant;
}

const iso = (i: Temporal.Instant | null) => i?.toString() ?? null;

/** The Workflows page: durable runs for one tenant, what they wait on, and operator actions. */
export function makeWorkflowRuns(deps: {
  workflows: PostgresWorkflows;
  describe: DescribeRun;
  search: Search;
  clocks: TenantClocks;
  queues: QueueClient;
}) {
  const sandbox = async (ctx: TenantContext) => {
    await deps.clocks.refresh(ctx.tenantId);

    return deps.clocks.isSandbox(ctx.tenantId);
  };

  const subjectsMatching = async (ctx: TenantContext, q: string) => {
    const hits = await deps.search(ctx, { kind: "tenant" }, { q, types: ["policy", "submission"] });

    return hits.flatMap((hit) => [
      workflowSubject(hit.type, hit.id),
      ...(hit.policyId ? [workflowSubject("policy", hit.policyId)] : []),
    ]);
  };

  const summary = async (ctx: TenantContext, run: WorkflowRunSummary) => ({
    runId: run.runId,
    workflowId: run.workflowId,
    status: run.status,
    currentStep: run.currentStep,
    subjects: run.subjects,
    error: run.error,
    cancelReason: run.cancelReason,
    createdAt: run.createdAt.toString(),
    updatedAt: run.updatedAt.toString(),
    completedAt: iso(run.completedAt),
    ...(await deps.describe(ctx, { ...run, stepId: run.currentStep })),
  });

  return {
    async list(ctx: TenantContext, input: RunListInput) {
      const subjects = [
        ...(input.subject ? [input.subject] : []),
        ...(input.q ? await subjectsMatching(ctx, input.q) : []),
      ];

      if (input.q && subjects.length === 0) return [];

      const runs = await deps.workflows.list(ctx, {
        ...(input.workflowId && { workflowIds: [input.workflowId] }),
        ...(input.status && { statuses: [input.status] }),
        ...(subjects.length > 0 && { subjects }),
        ...(input.before && { before: input.before }),
        limit: 50,
      });

      return Promise.all(runs.map((run) => summary(ctx, run)));
    },

    async get(ctx: TenantContext, input: { runId: string }) {
      const run = await deps.workflows.detail(ctx, input.runId);

      return {
        ...(await summary(ctx, run)),
        input: run.input,
        output: run.output,
        attempts: run.attempts,
        idempotencyKey: run.idempotencyKey,
        sandbox: await sandbox(ctx),
        steps: run.steps.map((s) => ({ ...s, completedAt: s.completedAt.toString() })),
        waits: run.waits.map((w) => ({
          stepId: w.stepId,
          event: w.event,
          wakeAt: iso(w.wakeAt),
          wallWakeAt: iso(w.wallWakeAt),
          since: w.since.toString(),
        })),
        signals: run.signals.map((s) => ({ ...s, at: s.at.toString() })),
      };
    },

    async retry(ctx: TenantContext, input: { runId: string }) {
      if (!(await deps.workflows.retry(ctx, input.runId)))
        throw conflict("Only a failed run can be retried");
    },

    async cancel(ctx: TenantContext, input: { runId: string; reason: string }) {
      await deps.workflows.cancel(ctx, input.runId, input.reason);
    },

    async wakeNow(ctx: TenantContext, input: { runId: string }) {
      if (!(await sandbox(ctx))) throw conflict("Waking a run early is only allowed in a sandbox");

      if (!(await deps.workflows.wakeNow(ctx, input.runId))) {
        throw conflict("This run isn't waiting on a timer");
      }
    },

    async reconcile(ctx: TenantContext, input: { days: number }) {
      await deps.queues.send(reconciliationQueue, { tenantId: ctx.tenantId, days: input.days });
    },
  };
}

export type WorkflowRuns = ReturnType<typeof makeWorkflowRuns>;

import type { TenantContext } from "@pas/kernel";
import { policyCancellationWorkflow, policyTermWorkflow, type TermTimers } from "@pas/policy";
import { type QuoteTimers, quoteJourneyWorkflow } from "@pas/submissions";
import type { SandboxTimers, UpcomingTimer } from "@pas/tenants";
import type { PostgresWorkflows, ScheduledTimer } from "@pas/workflows";

const POLL_MS = 200;
const QUIET_MS = 1_200;
const SETTLE_LIMIT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Describe = (
  ctx: TenantContext,
  timer: ScheduledTimer,
) => Promise<Pick<UpcomingTimer, "label" | "reference">>;

/** Turns the workflow engine's timers into what a sandbox user recognises. */
export function makeSandboxTimers(deps: {
  workflows: PostgresWorkflows;
  terms: TermTimers;
  quotes: QuoteTimers;
}): SandboxTimers {
  const describers: Record<string, Describe> = {
    [policyTermWorkflow.id]: async (ctx, timer) => {
      const policy = await deps.terms.describe(ctx, timer.input as { termId: string });

      return { label: "Policy becomes effective", reference: policy?.number ?? null };
    },
    [policyCancellationWorkflow.id]: async (ctx, timer) => {
      const policy = await deps.terms.describe(ctx, timer.input as { termId: string });

      return { label: "Cancellation takes effect", reference: policy?.number ?? null };
    },
    [quoteJourneyWorkflow.id]: async (ctx, timer) => {
      const quote = await deps.quotes.describe(ctx, timer.input as { quoteId: string });

      return { label: "Quote expires", reference: quote?.submissionNumber ?? null };
    },
  };

  const describe: Describe = (ctx, timer) =>
    describers[timer.workflowId]?.(ctx, timer) ??
    Promise.resolve({ label: timer.workflowId, reference: null });

  return {
    async upcoming(ctx, options) {
      const timers = await deps.workflows.timers(ctx, options);

      return Promise.all(
        timers.map(async (timer) => ({
          runId: timer.runId,
          workflowId: timer.workflowId,
          stepId: timer.stepId,
          dueAt: timer.dueAt,
          ...(await describe(ctx, timer)),
        })),
      );
    },
    release: (ctx) => deps.workflows.retime(ctx),
    // Woken runs can emit events that start more runs, so wait for a quiet spell, not just zero.
    async settle(ctx) {
      const deadline = Date.now() + SETTLE_LIMIT_MS;
      let quietSince = Date.now();

      while (Date.now() < deadline) {
        await sleep(POLL_MS);

        if ((await deps.workflows.activeRuns(ctx)) > 0) quietSince = Date.now();
        else if (Date.now() - quietSince >= QUIET_MS) return;
      }
    },
    async outcome(ctx, runId) {
      const run = await deps.workflows.status(ctx, runId);
      const output = run.output as { status?: unknown } | null;

      return run.status === "completed" && typeof output?.status === "string"
        ? output.status
        : run.status;
    },
  };
}

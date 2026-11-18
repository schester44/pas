import {
  newId,
  notFound,
  systemClock,
  type Clock,
  type Instant,
  type StartWorkflowOptions,
  type TenantContext,
  type TenantId,
  type WaitForOptions,
  type WorkflowDefinition,
  type WorkflowRef,
  type WorkflowRunState,
  type WorkflowRunStatus,
  type Workflows,
  type WorkflowStep,
} from "@pas/kernel";
import { durationToMilliseconds } from "./duration";

class Suspended extends Error {}

interface FakeRun {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly definition: WorkflowDefinition;
  readonly input: unknown;
  readonly createdAt: Instant;
  readonly timeline: Map<string, { value: unknown }>;
  readonly events: Map<string, Record<string, unknown>>;
  readonly wakeAt: Map<string, Instant>;
  status: WorkflowRunStatus;
  currentStep: string;
  output: unknown;
  error: string | null;
  completedAt: Instant | null;
}

/**
 * Replays runs in memory with the same semantics as the Postgres adapter: completed steps are
 * cached, waits suspend the run, and `runDue()` wakes timers against the injected clock.
 */
export class InMemoryWorkflows implements Workflows {
  private readonly definitions: Map<string, WorkflowDefinition>;
  private readonly runs = new Map<string, FakeRun>();
  private readonly idempotency = new Map<string, string>();

  constructor(
    definitions: readonly WorkflowDefinition[],
    private readonly clock: Clock = systemClock,
  ) {
    this.definitions = new Map(definitions.map((definition) => [definition.id, definition]));
  }

  async start<Input>(
    ctx: TenantContext,
    ref: WorkflowRef<Input>,
    input: Input,
    options: StartWorkflowOptions = {},
  ): Promise<{ runId: string }> {
    const key = options.idempotencyKey && `${ctx.tenantId}:${options.idempotencyKey}`;
    const existing = key && this.idempotency.get(key);

    if (existing) return { runId: existing };

    const definition = this.definitions.get(ref.id);

    if (!definition) throw new Error(`Unknown workflow ${ref.id}`);

    const run: FakeRun = {
      id: newId(),
      tenantId: ctx.tenantId,
      definition,
      input: ref.input.parse(input),
      createdAt: this.clock.now(),
      timeline: new Map(),
      events: new Map(),
      wakeAt: new Map(),
      status: "running",
      currentStep: "__start__",
      output: null,
      error: null,
      completedAt: null,
    };

    this.runs.set(run.id, run);

    if (key) this.idempotency.set(key, run.id);

    await this.execute(run);

    return { runId: run.id };
  }

  async signal(
    ctx: TenantContext,
    runId: string,
    event: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const run = this.find(ctx, runId);

    run.events.set(event, data);

    if (run.status === "waiting") await this.execute(run);
  }

  async cancel(ctx: TenantContext, runId: string): Promise<void> {
    const run = this.find(ctx, runId);

    if (run.status === "completed" || run.status === "failed") return;

    run.status = "cancelled";
    run.completedAt = this.clock.now();
  }

  async status(ctx: TenantContext, runId: string): Promise<WorkflowRunState> {
    const run = this.find(ctx, runId);

    return {
      runId: run.id,
      workflowId: run.definition.id,
      status: run.status,
      currentStep: run.currentStep,
      output: run.output,
      error: run.error,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    };
  }

  /** Resumes waiting runs whose delay or wait timeout has passed. */
  async runDue(): Promise<void> {
    const now = this.clock.now();

    for (const run of this.runs.values()) {
      const due = [...run.wakeAt.values()].some((at) => Temporal.Instant.compare(at, now) <= 0);

      if (run.status === "waiting" && due) await this.execute(run);
    }
  }

  private find(ctx: TenantContext, runId: string): FakeRun {
    const run = this.runs.get(runId);

    if (!run || run.tenantId !== ctx.tenantId) throw notFound("WorkflowRun", runId);

    return run;
  }

  private async execute(run: FakeRun): Promise<void> {
    run.status = "running";

    try {
      const output = await run.definition.run({
        input: run.input,
        tenantId: run.tenantId,
        runId: run.id,
        step: this.stepFor(run),
      });

      run.status = "completed";
      run.output = output ?? {};
      run.completedAt = this.clock.now();
    } catch (error) {
      if (error instanceof Suspended) {
        run.status = "waiting";

        return;
      }

      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      run.completedAt = this.clock.now();
    }
  }

  private stepFor(run: FakeRun): WorkflowStep {
    const record = (id: string, value: unknown) => {
      run.timeline.set(id, { value });
      run.wakeAt.delete(id);
    };

    const timerElapsed = (id: string, duration: Parameters<typeof durationToMilliseconds>[0]) => {
      const now = this.clock.now();

      const wakeAt =
        run.wakeAt.get(id) ?? now.add({ milliseconds: durationToMilliseconds(duration) });

      run.wakeAt.set(id, wakeAt);

      return Temporal.Instant.compare(wakeAt, now) <= 0;
    };

    return {
      run: async (id, fn) => {
        const cached = run.timeline.get(id);

        if (cached) return cached.value as Awaited<ReturnType<typeof fn>>;

        run.currentStep = id;
        const value = await fn();
        record(id, value);

        return value;
      },
      delay: async (id, duration) => {
        if (run.timeline.has(id)) return;

        run.currentStep = id;

        if (!timerElapsed(id, duration)) throw new Suspended();

        record(id, null);
      },
      waitFor: (async <T>(event: string, options: WaitForOptions<T> = {}) => {
        const id = options.stepId ?? event;
        const cached = run.timeline.get(id);

        if (cached) return cached.value;

        run.currentStep = id;
        const data = run.events.get(event);

        if (data) {
          const value = options.schema ? options.schema.parse(data) : data;
          record(id, value);

          return value;
        }

        if (options.timeout !== undefined && timerElapsed(id, options.timeout)) {
          record(id, undefined);

          return undefined;
        }

        throw new Suspended();
      }) as WorkflowStep["waitFor"],
    };
  }
}

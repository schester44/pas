import {
  newId,
  notFound,
  type StartWorkflowOptions,
  type TenantContext,
  type TenantId,
  type WorkflowDefinition,
  type WorkflowRef,
  type WorkflowRunState,
  type Workflows,
} from "@pas/kernel";
import { injectTraceContext, withExtractedContext, type Logger } from "@pas/observability";
import { Pool } from "pg";
import { PgBoss, type Db, type Job, type JobResult } from "pg-boss";
import { z } from "zod";
import type { WorkflowConnection } from "./config";
import { Halted, replayStep, Suspended } from "./replay";
import { DEFAULT_WORKFLOWS_SCHEMA, EXECUTE_QUEUE, schemaDdl, TIMER_QUEUE } from "./schema";
import { WorkflowStore, type Queryable, type RunKey, type RunRow } from "./store";
import { realTime, timerPlan, type TenantTime } from "./tenant-time";

export interface PostgresWorkflowsOptions extends WorkflowConnection {
  logger: Logger;
  /** Definitions this process executes. Omit where runs are only started and signalled (the API). */
  workflows?: readonly WorkflowDefinition[];
  schema?: string;
  bossSchema?: string;
  workers?: number;
  tenantTime?: TenantTime;
}

export interface ScheduledTimer {
  runId: string;
  workflowId: string;
  stepId: string;
  input: unknown;
  /** Tenant time. */
  dueAt: Temporal.Instant;
}

const DEFAULT_RETRIES = 3;
const MAX_BACKOFF_SECONDS = 300;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runKeySchema = z.object({ runId: z.string(), tenantId: z.string() });

/**
 * Durable workflows on Postgres and pg-boss. Each execution replays the handler against memoized
 * step results; the `stately` execute queue keyed by run id keeps one execution active per run.
 */
export class PostgresWorkflows implements Workflows {
  private readonly store: WorkflowStore;
  private readonly boss: PgBoss;
  private readonly definitions: Map<string, WorkflowDefinition>;
  private readonly schema: string;
  private readonly tenantTime: TenantTime;
  private opened: Promise<void> | undefined;
  private closed: Promise<void> | undefined;

  constructor(private readonly options: PostgresWorkflowsOptions) {
    this.schema = options.schema ?? DEFAULT_WORKFLOWS_SCHEMA;
    this.tenantTime = options.tenantTime ?? realTime;

    this.store = new WorkflowStore(
      new Pool({ connectionString: options.connectionString, application_name: "pas-workflows" }),
      this.schema,
    );

    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema: options.bossSchema ?? "pgboss",
      migrate: options.manageSchema,
      createSchema: options.manageSchema,
    });

    this.boss.on("error", (error) => options.logger.error({ err: error }, "pg-boss error"));
    this.definitions = new Map((options.workflows ?? []).map((d) => [d.id, d]));
  }

  open(): Promise<void> {
    this.opened ??= this.boot();

    return this.opened;
  }

  close(): Promise<void> {
    this.closed ??= this.shutdown();

    return this.closed;
  }

  private async shutdown(): Promise<void> {
    if (this.opened) {
      await this.opened.catch(() => undefined);
      await this.boss.stop({ graceful: true });
    }

    await this.store.pool.end();
  }

  async start<Input>(
    ctx: TenantContext,
    ref: WorkflowRef<Input>,
    input: Input,
    options: StartWorkflowOptions = {},
  ): Promise<{ runId: string }> {
    await this.open();

    const parsed = ref.input.parse(input);

    return this.store.transaction(async (client) => {
      const run = await this.store.insertRun(client, {
        id: newId(),
        tenantId: ctx.tenantId,
        workflowId: ref.id,
        input: parsed,
        trace: injectTraceContext(),
        idempotencyKey: options.idempotencyKey,
      });

      if (run.created) await this.enqueue(client, { runId: run.id, tenantId: ctx.tenantId });

      return { runId: run.id };
    });
  }

  async signal(
    ctx: TenantContext,
    runId: string,
    event: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.open();

    const key = this.key(ctx, runId);

    await this.store.transaction(async (client) => {
      const run = await this.store.find(client, key, "FOR SHARE");

      if (!run) throw notFound("WorkflowRun", runId);

      if (TERMINAL.has(run.status)) return;

      await this.store.insertEvent(client, key, event, data);
      await this.enqueue(client, key);
    });
  }

  async cancel(ctx: TenantContext, runId: string): Promise<void> {
    await this.open();

    const key = this.key(ctx, runId);

    if (!(await this.store.find(this.store.pool, key))) throw notFound("WorkflowRun", runId);

    await this.store.cancel(key);
  }

  async status(ctx: TenantContext, runId: string): Promise<WorkflowRunState> {
    await this.open();

    const run = await this.store.find(this.store.pool, this.key(ctx, runId));

    if (!run) throw notFound("WorkflowRun", runId);

    return toRunState(run);
  }

  async timers(
    ctx: TenantContext,
    options: { until?: Temporal.Instant; limit?: number } = {},
  ): Promise<ScheduledTimer[]> {
    await this.open();

    const until = options.until ? new Date(options.until.epochMilliseconds) : null;
    const rows = await this.store.timers(ctx.tenantId, until, options.limit ?? 500);

    return rows.map((row) => ({
      runId: row.run_id,
      workflowId: row.workflow_id,
      stepId: row.step_id,
      input: row.input,
      dueAt: toInstant(row.wake_at),
    }));
  }

  /** After the tenant's offset changed: wakes the timers now due and re-arms the rest earlier. */
  async retime(ctx: TenantContext): Promise<void> {
    await this.open();

    const offsetMs = await this.tenantTime.offsetMs(ctx.tenantId);
    const now = new Date();

    for (const row of await this.store.timers(ctx.tenantId, null, 10_000)) {
      const key = { runId: row.run_id, tenantId: ctx.tenantId };
      const plan = timerPlan(row.wake_at, offsetMs, now);

      if (plan.due) await this.enqueue(this.store.pool, key);
      else await this.scheduleTimer(this.store.pool, key, plan.startAfter);
    }
  }

  async activeRuns(ctx: TenantContext): Promise<number> {
    await this.open();

    return this.store.activeRuns(ctx.tenantId);
  }

  private key(ctx: TenantContext, runId: string): RunKey {
    if (!UUID.test(runId)) throw notFound("WorkflowRun", runId);

    return { runId, tenantId: ctx.tenantId };
  }

  private async boot(): Promise<void> {
    await this.boss.start();

    if (this.options.manageSchema) await this.install();

    if (this.definitions.size === 0) return;

    const workOptions = {
      localConcurrency: this.options.workers ?? 4,
      batchSize: 5,
      burstWhenBatchFull: true,
      pollingIntervalSeconds: 0.5,
      perJobResults: true,
    } as const;

    await this.boss.work(EXECUTE_QUEUE, workOptions, (jobs) =>
      this.settle(jobs, (key) => this.execute(key)),
    );

    await this.boss.work(TIMER_QUEUE, workOptions, (jobs) =>
      this.settle(jobs, (key) => this.enqueue(this.store.pool, key)),
    );
  }

  private async install(): Promise<void> {
    await this.store.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `workflows:${this.schema}`,
      ]);

      await client.query(schemaDdl(this.schema));
    });

    if (!(await this.boss.getQueue(EXECUTE_QUEUE))) {
      await this.boss.createQueue(EXECUTE_QUEUE, {
        policy: "stately",
        retryLimit: 5,
        retryBackoff: true,
        heartbeatSeconds: 30,
      });
    }

    if (!(await this.boss.getQueue(TIMER_QUEUE))) {
      await this.boss.createQueue(TIMER_QUEUE, { retryLimit: 5, retryBackoff: true });
    }
  }

  private settle(jobs: Job<unknown>[], handle: (key: RunKey) => Promise<void>) {
    return Promise.all(
      jobs.map(async (job): Promise<JobResult> => {
        try {
          const { runId, tenantId } = runKeySchema.parse(job.data);
          await handle({ runId, tenantId: tenantId as TenantId });

          return { id: job.id, status: "completed" };
        } catch (error) {
          this.options.logger.error({ err: error, jobId: job.id }, "workflow job failed");

          return { id: job.id, status: "failed", output: { message: String(error) } };
        }
      }),
    );
  }

  private async enqueue(db: Queryable, key: RunKey): Promise<void> {
    await this.boss.send(EXECUTE_QUEUE, key, { singletonKey: key.runId, db: bossDb(db) });
  }

  private async scheduleTimer(db: Queryable, key: RunKey, startAfter: Date | number) {
    await this.boss.send(TIMER_QUEUE, key, { startAfter, db: bossDb(db) });
  }

  // Leave runs for workflows this process lacks (e.g. an older worker) for a current worker to retry.
  private async rejectUnregistered(key: RunKey): Promise<void> {
    const run = await this.store.find(this.store.pool, key);

    if (run && !this.definitions.has(run.workflow_id)) {
      throw new Error(`Workflow ${run.workflow_id} is not registered here`);
    }
  }

  private async execute(key: RunKey): Promise<void> {
    const run = await this.store.claim(key, [...this.definitions.keys()]);

    if (!run) return this.rejectUnregistered(key);

    const definition = this.definitions.get(run.workflow_id);

    if (!definition) throw new Error(`Workflow ${run.workflow_id} is not registered here`);

    await withExtractedContext(run.trace, `workflow ${run.workflow_id}`, async (span) => {
      span.setAttribute("workflow.run_id", run.id);
      span.setAttribute("workflow.attempt", run.attempts);
      span.setAttribute("tenant.id", run.tenant_id);

      const memo = await this.store.loadSteps(key);
      const offsetMs = await this.tenantTime.offsetMs(key.tenantId);

      const step = replayStep(
        this.store,
        key,
        memo,
        (db, wakeAt) =>
          this.scheduleTimer(db, key, timerPlan(wakeAt, offsetMs, new Date()).startAfter),
        offsetMs,
      );

      try {
        const output = await definition.run({
          input: definition.input.parse(run.input),
          tenantId: run.tenant_id,
          runId: run.id,
          step,
        });

        await this.store.finish(key, "completed", output, null);
      } catch (error) {
        if (error instanceof Halted) return;

        if (error instanceof Suspended) return this.store.suspend(key);

        await this.fail(key, definition, error);
      }
    });
  }

  private async fail(key: RunKey, definition: WorkflowDefinition, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = await this.store.recordFailure(key, message);

    if (attempts === 0) return;

    const log = { err: error, runId: key.runId, workflowId: definition.id, attempts };

    if (attempts <= (definition.retries ?? DEFAULT_RETRIES)) {
      this.options.logger.warn(log, "workflow execution failed, retrying");
      await this.scheduleTimer(this.store.pool, key, backoffSeconds(attempts));

      return;
    }

    this.options.logger.error(log, "workflow run failed");
    await this.store.finish(key, "failed", null, message);
  }
}

function backoffSeconds(attempt: number): number {
  return Math.min(2 ** (attempt - 1), MAX_BACKOFF_SECONDS);
}

function bossDb(db: Queryable): Db {
  return { executeSql: (text, values) => db.query(text, values) };
}

function toRunState(run: RunRow): WorkflowRunState {
  return {
    runId: run.id,
    workflowId: run.workflow_id,
    status: run.status,
    currentStep: run.current_step,
    output: run.output,
    error: run.error,
    createdAt: toInstant(run.created_at),
    completedAt: run.completed_at ? toInstant(run.completed_at) : null,
  };
}

function toInstant(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime());
}

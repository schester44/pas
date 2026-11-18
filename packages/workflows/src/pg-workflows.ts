import {
  notFound,
  type StartWorkflowOptions,
  type TenantContext,
  type TenantId,
  type WaitForOptions,
  type WorkflowDefinition,
  type WorkflowDuration,
  type WorkflowRef,
  type WorkflowRunState,
  type WorkflowRunStatus,
  type Workflows,
  type WorkflowStep,
} from "@pas/kernel";
import { injectTraceContext, withExtractedContext, type Logger } from "@pas/observability";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import {
  workflow,
  WorkflowClient,
  WorkflowEngine,
  WorkflowRunNotFoundError,
  type StepBaseContext,
  type WorkflowContext as EngineContext,
  type WorkflowDefinition as EngineDefinition,
  type WorkflowLogger,
  type WorkflowPlugin,
  type WorkflowRun,
} from "pg-workflows";
import type { WorkflowConnection } from "./config";
import { durationToMilliseconds } from "./duration";

/** Keeps pg-workflows' unqualified `workflow_runs` out of Prisma's `public` schema. */
export const WORKFLOWS_SCHEMA = "pgworkflows";
const PGBOSS_SCHEMA = "pgboss";

interface RunEnvelope {
  tenantId: TenantId;
  actor: TenantContext["actor"];
  input: unknown;
  trace: Record<string, string>;
}

export interface PgWorkflowsOptions extends WorkflowConnection {
  logger: Logger;
  /** Definitions this process executes. Omit where runs are only started and signalled (the API). */
  workflows?: readonly WorkflowDefinition[];
}

type Backend = Pick<
  WorkflowEngine,
  "start" | "stop" | "startWorkflow" | "triggerEvent" | "cancelWorkflow" | "getRun"
>;

export class PgWorkflows implements Workflows {
  private readonly pool: Pool;
  private readonly backend: Backend;
  private readonly executes: boolean;
  private opened: Promise<void> | undefined;

  constructor(private readonly options: PgWorkflowsOptions) {
    const connection = {
      connectionString: options.connectionString,
      options: `-c search_path=${WORKFLOWS_SCHEMA}`,
      application_name: "pas-workflows",
    };

    this.pool = new Pool(connection);

    const boss = new PgBoss({
      ...connection,
      schema: PGBOSS_SCHEMA,
      migrate: options.manageSchema,
      createSchema: options.manageSchema,
    });

    boss.on("error", (error) => options.logger.error({ err: error }, "pg-boss error"));

    const logger = engineLogger(options.logger);

    this.executes = (options.workflows?.length ?? 0) > 0;

    this.backend = options.workflows
      ? new WorkflowEngine({
          pool: this.pool,
          boss,
          logger,
          workflows: options.workflows.map(toEngineDefinition),
        })
      : new WorkflowClient({ pool: this.pool, boss, logger });
  }

  open(): Promise<void> {
    this.opened ??= this.install().then(() => this.backend.start(this.executes));

    return this.opened;
  }

  async close(): Promise<void> {
    await this.backend.stop();
    await this.pool.end();
  }

  async start<Input>(
    ctx: TenantContext,
    ref: WorkflowRef<Input>,
    input: Input,
    options: StartWorkflowOptions = {},
  ): Promise<{ runId: string }> {
    await this.open();

    const envelope: RunEnvelope = {
      tenantId: ctx.tenantId,
      actor: ctx.actor,
      input: ref.input.parse(input),
      trace: injectTraceContext(),
    };

    const run = await this.backend.startWorkflow({
      workflowId: ref.id,
      input: envelope,
      resourceId: ctx.tenantId,
      ...(options.idempotencyKey
        ? { idempotencyKey: `${ctx.tenantId}:${options.idempotencyKey}` }
        : {}),
    });

    return { runId: run.id };
  }

  async signal(
    ctx: TenantContext,
    runId: string,
    event: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.scoped(runId, () =>
      this.backend.triggerEvent({ runId, resourceId: ctx.tenantId, eventName: event, data }),
    );
  }

  async cancel(ctx: TenantContext, runId: string): Promise<void> {
    await this.scoped(runId, () =>
      this.backend.cancelWorkflow({ runId, resourceId: ctx.tenantId }),
    );
  }

  async status(ctx: TenantContext, runId: string): Promise<WorkflowRunState> {
    const run = await this.scoped(runId, () =>
      this.backend.getRun({ runId, resourceId: ctx.tenantId }),
    );

    return toRunState(run);
  }

  private async scoped(runId: string, call: () => Promise<WorkflowRun>): Promise<WorkflowRun> {
    await this.open();

    try {
      return await call();
    } catch (error) {
      if (error instanceof WorkflowRunNotFoundError) throw notFound("WorkflowRun", runId);

      throw error;
    }
  }

  private async install(): Promise<void> {
    if (this.options.manageSchema)
      await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${WORKFLOWS_SCHEMA}`);
  }
}

const tenantTracing: WorkflowPlugin = {
  name: "pas-tenant-tracing",
  methods: () => ({}),
  wrap: (context, next) => {
    const envelope = context.input as RunEnvelope;

    return withExtractedContext(envelope.trace, `workflow ${context.workflowId}`, async (span) => {
      span.setAttribute("workflow.run_id", context.runId);
      span.setAttribute("workflow.attempt", context.attempt);
      span.setAttribute("tenant.id", envelope.tenantId);

      return next();
    });
  },
};

const tracedWorkflow = workflow.use(tenantTracing);

function toEngineDefinition(definition: WorkflowDefinition): EngineDefinition {
  return tracedWorkflow(
    definition.id,
    async (context: EngineContext) => {
      const envelope = context.input as RunEnvelope;

      const output = await definition.run({
        input: definition.input.parse(envelope.input),
        tenantId: envelope.tenantId,
        runId: context.runId,
        step: adaptStep(context.step),
      });

      // With plugins, pg-workflows completes a run only when the handler returns a defined value.
      return output ?? {};
    },
    definition.retries === undefined ? {} : { retries: definition.retries },
  );
}

function adaptStep(engine: StepBaseContext): WorkflowStep {
  return {
    run: (id, fn) => engine.run(id, fn),
    delay: (id, duration: WorkflowDuration) =>
      engine.delay(id, { seconds: durationToMilliseconds(duration) / 1000 }),
    waitFor: (async <T>(event: string, options: WaitForOptions<T> = {}) => {
      const stepId = options.stepId ?? event;

      const data =
        options.timeout === undefined
          ? await engine.waitFor(stepId, { eventName: event })
          : await engine.waitFor(stepId, {
              eventName: event,
              timeout: durationToMilliseconds(options.timeout),
            });

      if (data === undefined) return undefined;

      return options.schema ? options.schema.parse(data) : data;
    }) as WorkflowStep["waitFor"],
  };
}

const STATUS: Record<WorkflowRun["status"], WorkflowRunStatus> = {
  pending: "pending",
  running: "running",
  paused: "waiting",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

function toRunState(run: WorkflowRun): WorkflowRunState {
  return {
    runId: run.id,
    workflowId: run.workflowId,
    status: STATUS[run.status],
    currentStep: run.currentStepId,
    output: run.output,
    error: run.error,
    createdAt: toInstant(run.createdAt),
    completedAt: run.completedAt ? toInstant(run.completedAt) : null,
  };
}

function toInstant(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(new Date(date).getTime());
}

function engineLogger(logger: Logger): WorkflowLogger {
  return {
    log: (message) => logger.debug(message),
    error: (message, error) => logger.error({ err: error }, message),
  };
}

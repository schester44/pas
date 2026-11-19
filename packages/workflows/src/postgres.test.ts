import {
  defineWorkflow,
  newId,
  workflowRef,
  type TenantContext,
  type TenantId,
  type WorkflowRunState,
} from "@pas/kernel";
import { createLogger } from "@pas/observability";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { PostgresWorkflows, type PostgresWorkflowsOptions } from "./postgres";

const connectionString = process.env.DATABASE_URL;
const suffix = Math.random().toString(36).slice(2, 10);

const base = {
  connectionString: connectionString ?? "",
  manageSchema: true,
  logger: createLogger("workflows-test"),
  schema: `workflows_test_${suffix}`,
  bossSchema: `pgboss_test_${suffix}`,
} satisfies PostgresWorkflowsOptions;

const ctx: TenantContext = {
  tenantId: newId<"Tenant">() as TenantId,
  actor: { type: "system", process: "test" },
};

const pair = workflowRef("test.pair", z.object({ n: z.number() }));

const pairWorkflow = defineWorkflow(pair, async ({ input, step }) => {
  const doubled = await step.run("double", async () => input.n * 2);

  return step.run("increment", async () => doubled + 1);
});

const approval = workflowRef("test.approval", z.object({ slowMs: z.number() }));

const approvalWorkflow = defineWorkflow(approval, async ({ input, step }) => {
  await step.run("requested", () => new Promise((resolve) => setTimeout(resolve, input.slowMs)));

  const decision = await step.waitFor("approved", {
    timeout: "2 seconds",
    schema: z.object({ by: z.string() }),
  });

  return { approvedBy: decision?.by ?? null };
});

let failures = 0;
const flaky = workflowRef("test.flaky", z.object({}));

const flakyWorkflow = defineWorkflow(
  flaky,
  ({ step }) =>
    step.run("call", async () => {
      if (failures++ === 0) throw new Error("transient");

      return "ok";
    }),
  { retries: 1 },
);

const definitions = [pairWorkflow, approvalWorkflow, flakyWorkflow];

async function settled(workflows: PostgresWorkflows, runId: string, statuses: string[]) {
  const deadline = Date.now() + 15_000;
  let state: WorkflowRunState;

  do {
    state = await workflows.status(ctx, runId);

    if (statuses.includes(state.status)) return state;

    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);

  return state;
}

describe.skipIf(!connectionString)("PostgresWorkflows", () => {
  const engine = new PostgresWorkflows({ ...base, workflows: definitions });
  const pool = new Pool({ connectionString });

  afterAll(async () => {
    await engine.close();
    await pool.query(`DROP SCHEMA IF EXISTS ${base.schema} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${base.bossSchema} CASCADE`);
    await pool.end();
  });

  it("completes many concurrent runs and leaves no open transactions", async () => {
    const runs = await Promise.all(
      Array.from({ length: 25 }, (_, n) => engine.start(ctx, pair, { n })),
    );

    const states = await Promise.all(
      runs.map(({ runId }) => settled(engine, runId, ["completed"])),
    );

    expect(states.map((state) => state.output)).toEqual(runs.map((_, n) => n * 2 + 1));

    const { rows } = await pool.query(
      `SELECT count(*)::int AS open FROM pg_stat_activity
       WHERE application_name = 'pas-workflows' AND state LIKE 'idle in transaction%'`,
    );

    expect(rows[0].open).toBe(0);
  }, 30_000);

  it("resumes a wait after a worker restart, keeps early signals and times out", async () => {
    const waiting = await engine.start(ctx, approval, { slowMs: 0 });
    const early = await engine.start(ctx, approval, { slowMs: 500 });
    const ignored = await engine.start(ctx, approval, { slowMs: 0 });

    await engine.signal(ctx, early.runId, "approved", { by: "early" });
    expect((await settled(engine, waiting.runId, ["waiting"])).status).toBe("waiting");

    const other: TenantContext = { ...ctx, tenantId: newId<"Tenant">() as TenantId };
    await expect(engine.status(other, waiting.runId)).rejects.toThrow();

    await engine.close();

    const restarted = new PostgresWorkflows({ ...base, workflows: definitions });

    try {
      await restarted.signal(ctx, waiting.runId, "approved", { by: "underwriter" });

      expect((await settled(restarted, waiting.runId, ["completed"])).output).toEqual({
        approvedBy: "underwriter",
      });

      expect((await settled(restarted, early.runId, ["completed"])).output).toEqual({
        approvedBy: "early",
      });

      expect((await settled(restarted, ignored.runId, ["completed"])).output).toEqual({
        approvedBy: null,
      });

      const retried = await restarted.start(ctx, flaky, {});
      expect((await settled(restarted, retried.runId, ["completed", "failed"])).output).toBe("ok");
    } finally {
      await restarted.close();
    }
  }, 30_000);
});

describe.skipIf(!connectionString)("PostgresWorkflows orphan sweep", () => {
  const sweepBase = {
    ...base,
    schema: `workflows_sweep_${suffix}`,
    bossSchema: `pgboss_sweep_${suffix}`,
  };

  const pool = new Pool({ connectionString });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${sweepBase.schema} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${sweepBase.bossSchema} CASCADE`);
    await pool.end();
  });

  it("re-enqueues a run whose job was lost so a current worker finishes it", async () => {
    const starter = new PostgresWorkflows(sweepBase);
    const { runId } = await starter.start(ctx, pair, { n: 4 });

    await pool.query(`DELETE FROM ${sweepBase.bossSchema}.job WHERE data->>'runId' = $1`, [runId]);

    await pool.query(
      `UPDATE ${sweepBase.schema}.runs
       SET status = 'running', updated_at = now() - interval '30 minutes' WHERE id = $1`,
      [runId],
    );

    await starter.close();

    const worker = new PostgresWorkflows({ ...sweepBase, workflows: definitions });

    try {
      await worker.open();
      expect(await worker.sweep()).toBe(1);
      expect((await settled(worker, runId, ["completed"])).output).toBe(9);
    } finally {
      await worker.close();
    }
  }, 30_000);
});

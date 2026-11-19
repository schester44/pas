import type { TenantId, WorkflowRunStatus } from "@pas/kernel";
import type { Pool, PoolClient } from "pg";
import { assertIdentifier } from "./schema";

export type Queryable = Pick<Pool, "query">;

export interface RunRow {
  id: string;
  tenant_id: TenantId;
  workflow_id: string;
  input: unknown;
  trace: Record<string, string>;
  status: WorkflowRunStatus;
  current_step: string;
  output: unknown;
  error: string | null;
  attempts: number;
  idempotency_key: string | null;
  subjects: string[];
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface StepRow {
  step_id: string;
  result: StepResult;
  completed_at: Date;
}

export interface WaitRow {
  step_id: string;
  event: string | null;
  wake_at: Date | null;
  created_at: Date;
}

export interface EventRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  consumed_by: string | null;
  created_at: Date;
}

export interface RunFilter {
  workflowIds?: readonly string[];
  statuses?: readonly WorkflowRunStatus[];
  subjects?: readonly string[];
  before?: Date;
  limit: number;
}

export interface NewRun {
  id: string;
  tenantId: TenantId;
  workflowId: string;
  input: unknown;
  trace: Record<string, string>;
  idempotencyKey: string | undefined;
  subjects: readonly string[];
}

export interface RunKey {
  runId: string;
  tenantId: TenantId;
}

export interface TimerRow {
  run_id: string;
  step_id: string;
  wake_at: Date;
  workflow_id: string;
  input: unknown;
}

interface StepResult {
  value?: unknown;
}

const LIVE = `('pending', 'running', 'waiting')`;

export class WorkflowStore {
  private readonly s: string;

  constructor(
    readonly pool: Pool,
    schema: string,
  ) {
    this.s = assertIdentifier(schema);
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;

    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");

      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch((rollbackError: Error) => (broken = rollbackError));
      throw error;
    } finally {
      client.release(broken);
    }
  }

  /** Returns the id of the run, which is an existing one when the idempotency key was taken. */
  async insertRun(db: Queryable, run: NewRun): Promise<{ id: string; created: boolean }> {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO ${this.s}.runs (id, tenant_id, workflow_id, input, trace, status, idempotency_key, subjects)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        run.id,
        run.tenantId,
        run.workflowId,
        JSON.stringify(run.input),
        JSON.stringify(run.trace),
        run.idempotencyKey ?? null,
        [...new Set(run.subjects)],
      ],
    );

    if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

    const existing = await db.query<{ id: string }>(
      `SELECT id FROM ${this.s}.runs WHERE tenant_id = $1 AND idempotency_key = $2`,
      [run.tenantId, run.idempotencyKey],
    );

    return { id: existing.rows[0]!.id, created: false };
  }

  async find(db: Queryable, { runId, tenantId }: RunKey, lock = ""): Promise<RunRow | undefined> {
    const { rows } = await db.query<RunRow>(
      `SELECT * FROM ${this.s}.runs WHERE id = $1 AND tenant_id = $2 ${lock}`,
      [runId, tenantId],
    );

    return rows[0];
  }

  async claim(
    { runId, tenantId }: RunKey,
    workflowIds: readonly string[],
  ): Promise<RunRow | undefined> {
    const { rows } = await this.pool.query<RunRow>(
      `UPDATE ${this.s}.runs SET status = 'running', version = version + 1, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status IN ${LIVE} AND workflow_id = ANY($3)
       RETURNING *`,
      [runId, tenantId, workflowIds],
    );

    return rows[0];
  }

  async loadSteps({ runId, tenantId }: RunKey): Promise<Map<string, unknown>> {
    const { rows } = await this.pool.query<{ step_id: string; result: StepResult }>(
      `SELECT step_id, result FROM ${this.s}.steps WHERE run_id = $1 AND tenant_id = $2`,
      [runId, tenantId],
    );

    return new Map(rows.map((row) => [row.step_id, row.result.value]));
  }

  /** False once the run was cancelled or finished elsewhere, so the execution must stop. */
  async enterStep({ runId, tenantId }: RunKey, stepId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.s}.runs SET current_step = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'running'`,
      [runId, tenantId, stepId],
    );

    return rowCount === 1;
  }

  /** First write wins, so a duplicate execution adopts the result already recorded. */
  async memoize(db: Queryable, key: RunKey, stepId: string, value: unknown): Promise<unknown> {
    const inserted = await db.query<{ result: StepResult }>(
      `INSERT INTO ${this.s}.steps (run_id, tenant_id, step_id, result) VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id, step_id) DO NOTHING
       RETURNING result`,
      [key.runId, key.tenantId, stepId, JSON.stringify({ value })],
    );

    const row =
      inserted.rows[0] ??
      (
        await db.query<{ result: StepResult }>(
          `SELECT result FROM ${this.s}.steps WHERE run_id = $1 AND tenant_id = $2 AND step_id = $3`,
          [key.runId, key.tenantId, stepId],
        )
      ).rows[0]!;

    await db.query(
      `DELETE FROM ${this.s}.waits WHERE run_id = $1 AND tenant_id = $2 AND step_id = $3`,
      [key.runId, key.tenantId, stepId],
    );

    return row.result.value;
  }

  async consumeEvent(db: Queryable, { runId, tenantId }: RunKey, name: string, stepId: string) {
    const { rows } = await db.query<{ data: Record<string, unknown> }>(
      `UPDATE ${this.s}.events SET consumed_by = $4
       WHERE id = (
         SELECT id FROM ${this.s}.events
         WHERE run_id = $1 AND tenant_id = $2 AND name = $3 AND consumed_by IS NULL
         ORDER BY id LIMIT 1 FOR UPDATE
       )
       RETURNING data`,
      [runId, tenantId, name, stepId],
    );

    return rows[0]?.data;
  }

  async insertEvent(db: Queryable, { runId, tenantId }: RunKey, name: string, data: object) {
    await db.query(
      `INSERT INTO ${this.s}.events (run_id, tenant_id, name, data) VALUES ($1, $2, $3, $4)`,
      [runId, tenantId, name, JSON.stringify(data)],
    );
  }

  /** Registers the wait once and reports whether it is due and whether this call created it. */
  async wait(
    db: Queryable,
    key: RunKey,
    stepId: string,
    event: string | null,
    timeoutMs: number | null,
    offsetMs: number,
  ): Promise<{ wakeAt: Date | null; due: boolean; created: boolean }> {
    const values = [key.runId, key.tenantId, stepId];

    const inserted = await db.query<{ wake_at: Date | null; due: boolean }>(
      `INSERT INTO ${this.s}.waits (run_id, tenant_id, step_id, event, wake_at)
       VALUES ($1, $2, $3, $4, now() + ($6::bigint + $5) * interval '1 millisecond')
       ON CONFLICT (run_id, step_id) DO NOTHING
       RETURNING wake_at, coalesce(wake_at <= now() + $6::bigint * interval '1 millisecond', false) AS due`,
      [...values, event, timeoutMs, offsetMs],
    );

    if (inserted.rows[0])
      return { wakeAt: inserted.rows[0].wake_at, due: inserted.rows[0].due, created: true };

    const { rows } = await db.query<{ wake_at: Date | null; due: boolean }>(
      `SELECT wake_at, coalesce(wake_at <= now() + $4::bigint * interval '1 millisecond', false) AS due
       FROM ${this.s}.waits
       WHERE run_id = $1 AND tenant_id = $2 AND step_id = $3`,
      [...values, offsetMs],
    );

    return { wakeAt: rows[0]!.wake_at, due: rows[0]!.due, created: false };
  }

  /** Timed waits of live runs, earliest first, in tenant time. */
  async timers(tenantId: TenantId, until: Date | null, limit: number): Promise<TimerRow[]> {
    const { rows } = await this.pool.query<TimerRow>(
      `SELECT w.run_id, w.step_id, w.wake_at, r.workflow_id, r.input
       FROM ${this.s}.waits w JOIN ${this.s}.runs r ON r.id = w.run_id
       WHERE w.tenant_id = $1 AND w.wake_at IS NOT NULL AND r.status IN ${LIVE}
         AND ($2::timestamptz IS NULL OR w.wake_at <= $2)
       ORDER BY w.wake_at, w.run_id
       LIMIT $3`,
      [tenantId, until, limit],
    );

    return rows;
  }

  /** Live runs nothing will wake: stuck pending/running, or past-due timed waits (wall time). */
  async orphans(staleMinutes: number, limit: number): Promise<RunKey[]> {
    const { rows } = await this.pool.query<{ id: string; tenant_id: TenantId }>(
      `SELECT r.id, r.tenant_id FROM ${this.s}.runs r
       WHERE (r.status IN ('pending', 'running')
              AND r.updated_at < now() - $1::int * interval '1 minute')
          OR (r.status = 'waiting' AND EXISTS (
                SELECT 1 FROM ${this.s}.waits w
                WHERE w.run_id = r.id AND w.wake_at < now() - $1::int * interval '1 minute'))
       ORDER BY r.updated_at
       LIMIT $2`,
      [staleMinutes, limit],
    );

    return rows.map((row) => ({ runId: row.id, tenantId: row.tenant_id }));
  }

  async activeRuns(tenantId: TenantId): Promise<number> {
    const { rows } = await this.pool.query<{ active: number }>(
      `SELECT count(*)::int AS active FROM ${this.s}.runs
       WHERE tenant_id = $1 AND status IN ('pending', 'running')`,
      [tenantId],
    );

    return rows[0]?.active ?? 0;
  }

  async suspend({ runId, tenantId }: RunKey): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.s}.runs SET status = 'waiting', attempts = 0, error = NULL, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'running'`,
      [runId, tenantId],
    );
  }

  async finish(
    { runId, tenantId }: RunKey,
    status: "completed" | "failed",
    output: unknown,
    error: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.s}.runs
       SET status = $3, output = $4, error = $5, completed_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'running'`,
      [runId, tenantId, status, JSON.stringify(output ?? null), error],
    );

    await this.clearWaits({ runId, tenantId });
  }

  /** Returns the attempt number just recorded. */
  async recordFailure({ runId, tenantId }: RunKey, error: string): Promise<number> {
    const { rows } = await this.pool.query<{ attempts: number }>(
      `UPDATE ${this.s}.runs SET attempts = attempts + 1, error = $3, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'running'
       RETURNING attempts`,
      [runId, tenantId, error],
    );

    return rows[0]?.attempts ?? 0;
  }

  async cancel(key: RunKey, reason: string | null): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.s}.runs
       SET status = 'cancelled', cancel_reason = $3, completed_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status IN ${LIVE}`,
      [key.runId, key.tenantId, reason],
    );

    await this.clearWaits(key);

    return rowCount === 1;
  }

  /** Newest first; `subjects` matches runs tagged with any of them. */
  async list(tenantId: TenantId, filter: RunFilter): Promise<RunRow[]> {
    const { rows } = await this.pool.query<RunRow>(
      `SELECT * FROM ${this.s}.runs
       WHERE tenant_id = $1
         AND ($2::text[] IS NULL OR workflow_id = ANY($2))
         AND ($3::text[] IS NULL OR status = ANY($3))
         AND ($4::text[] IS NULL OR subjects && $4)
         AND ($5::timestamptz IS NULL OR created_at < $5)
       ORDER BY created_at DESC, id DESC
       LIMIT $6`,
      [
        tenantId,
        filter.workflowIds ?? null,
        filter.statuses ?? null,
        filter.subjects ?? null,
        filter.before ?? null,
        filter.limit,
      ],
    );

    return rows;
  }

  async history({ runId, tenantId }: RunKey) {
    const values = [runId, tenantId];

    const [steps, waits, events] = await Promise.all([
      this.pool.query<StepRow>(
        `SELECT step_id, result, completed_at FROM ${this.s}.steps
         WHERE run_id = $1 AND tenant_id = $2 ORDER BY completed_at, step_id`,
        values,
      ),
      this.pool.query<WaitRow>(
        `SELECT step_id, event, wake_at, created_at FROM ${this.s}.waits
         WHERE run_id = $1 AND tenant_id = $2 ORDER BY created_at`,
        values,
      ),
      this.pool.query<EventRow>(
        `SELECT id::text, name, data, consumed_by, created_at FROM ${this.s}.events
         WHERE run_id = $1 AND tenant_id = $2 ORDER BY id`,
        values,
      ),
    ]);

    return { steps: steps.rows, waits: waits.rows, events: events.rows };
  }

  /** A failed run goes back to pending with its memoized steps intact, so it resumes where it failed. */
  async retry({ runId, tenantId }: RunKey): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.s}.runs
       SET status = 'pending', attempts = 0, error = NULL, completed_at = NULL, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'failed'`,
      [runId, tenantId],
    );

    return rowCount === 1;
  }

  /** Pulls the run's timed waits to the tenant's now; returns how many moved. */
  async wakeNow({ runId, tenantId }: RunKey, offsetMs: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.s}.waits w SET wake_at = now() + $3::bigint * interval '1 millisecond'
       FROM ${this.s}.runs r
       WHERE w.run_id = $1 AND w.tenant_id = $2 AND w.wake_at IS NOT NULL
         AND r.id = w.run_id AND r.status = 'waiting'`,
      [runId, tenantId, offsetMs],
    );

    return rowCount ?? 0;
  }

  private async clearWaits({ runId, tenantId }: RunKey): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.s}.waits WHERE run_id = $1 AND tenant_id = $2`, [
      runId,
      tenantId,
    ]);
  }
}

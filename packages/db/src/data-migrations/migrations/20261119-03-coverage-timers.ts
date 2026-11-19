import { jurisdiction } from "@pas/kernel";
import { coverageWake } from "../coverage-timers";
import { migration } from "../types";

interface Wait {
  run_id: string;
  tenant_id: string;
  step_id: string;
  wake_ms: string;
  on: string | null;
  country: string;
  subdivision: string | null;
  offset_ms: string;
}

// Timestamps cross as epoch milliseconds: the driver adapter misreads timestamptz in raw queries.
// The step memo holds the relative wait, not its target, so moving the wait row and its timer
// job is the whole change: the replay reads the wait's (new) wake time back on the next run.
const WAITS = `
  SELECT w.run_id::text, w.tenant_id, w.step_id,
    (extract(epoch FROM w.wake_at) * 1000)::bigint::text AS wake_ms,
    (CASE WHEN r.workflow_id = 'policy.term' THEN t.effective_date ELSE x.effective_date END)::text AS on,
    t.country, t.subdivision, coalesce(e.clock_offset_ms, 0)::text AS offset_ms
  FROM workflows.waits w
  JOIN workflows.runs r ON r.id = w.run_id
  JOIN policy_terms t ON t.tenant_id = r.tenant_id AND t.id::text = r.input->>'termId'
  LEFT JOIN policy_transactions x
    ON x.tenant_id = r.tenant_id AND x.id::text = r.input->>'transactionId'
  LEFT JOIN tenant_environments e ON e.tenant_id = r.tenant_id
  WHERE r.status IN ('pending', 'running', 'waiting') AND w.wake_at IS NOT NULL
    AND (
      (r.workflow_id = 'policy.term' AND w.step_id = 'effective-date')
      OR (r.workflow_id = 'policy.cancellation' AND w.step_id = 'cancellation-date')
    )`;

/** Coverage timers set before jurisdiction time woke at UTC midnight; move them to 12:01 a.m. local standard. */
export default migration({
  name: "20261119-03-coverage-timers",
  async up({ db }) {
    const [state] = await db.$queryRawUnsafe<{ installed: boolean }[]>(
      `SELECT to_regclass('workflows.waits') IS NOT NULL AND to_regclass('pgboss.job') IS NOT NULL AS installed`,
    );

    if (!state?.installed) return;

    let moved = 0;
    let rearmed = 0;

    for (const wait of await db.$queryRawUnsafe<Wait[]>(WAITS)) {
      if (!wait.on) continue;

      const target = coverageWake(
        Temporal.Instant.fromEpochMilliseconds(Number(wait.wake_ms)),
        Temporal.PlainDate.from(wait.on),
        jurisdiction(wait.country, wait.subdivision),
      );

      if (!target) continue;

      const wallMs = target.epochMilliseconds - Number(wait.offset_ms);

      await db.$transaction([
        db.$executeRawUnsafe(
          `UPDATE workflows.waits SET wake_at = to_timestamp($3::bigint / 1000.0)
           WHERE run_id = $1::uuid AND step_id = $2`,
          wait.run_id,
          wait.step_id,
          target.epochMilliseconds,
        ),
        db.$executeRawUnsafe(
          `UPDATE pgboss.job SET start_after = to_timestamp($2::bigint / 1000.0)
           WHERE name = 'workflow.timer' AND state IN ('created', 'retry') AND data->>'runId' = $1`,
          wait.run_id,
          wallMs,
        ),
      ]);

      const [jobs] = await db.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM pgboss.job
         WHERE name = 'workflow.timer' AND state IN ('created', 'retry') AND data->>'runId' = $1`,
        wait.run_id,
      );

      moved++;

      if (jobs?.count) rearmed++;
      else console.warn(`Run ${wait.run_id} has no pending timer job; a retime will re-arm it`);
    }

    console.log(`Moved ${moved} coverage timers to local time; ${rearmed} timer jobs rescheduled`);
  },
});

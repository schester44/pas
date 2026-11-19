export const DEFAULT_WORKFLOWS_SCHEMA = "workflows";

export const EXECUTE_QUEUE = "workflow.execute";
export const TIMER_QUEUE = "workflow.timer";
export const SWEEP_QUEUE = "workflow.sweep";

export function assertIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid schema name "${name}"`);

  return name;
}

export function schemaDdl(schema: string): string {
  const s = assertIdentifier(schema);

  return `
    CREATE SCHEMA IF NOT EXISTS ${s};

    CREATE TABLE IF NOT EXISTS ${s}.runs (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL,
      workflow_id text NOT NULL,
      input jsonb NOT NULL,
      trace jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL,
      current_step text NOT NULL DEFAULT '__start__',
      output jsonb,
      error text,
      attempts integer NOT NULL DEFAULT 0,
      idempotency_key text,
      version integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );

    CREATE UNIQUE INDEX IF NOT EXISTS runs_idempotency_key
      ON ${s}.runs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS runs_tenant_workflow_status ON ${s}.runs (tenant_id, workflow_id, status);

    ALTER TABLE ${s}.runs ADD COLUMN IF NOT EXISTS subjects text[] NOT NULL DEFAULT '{}';
    ALTER TABLE ${s}.runs ADD COLUMN IF NOT EXISTS cancel_reason text;
    CREATE INDEX IF NOT EXISTS runs_subjects ON ${s}.runs USING gin (subjects);
    CREATE INDEX IF NOT EXISTS runs_tenant_created ON ${s}.runs (tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS ${s}.steps (
      run_id uuid NOT NULL REFERENCES ${s}.runs (id) ON DELETE CASCADE,
      tenant_id text NOT NULL,
      step_id text NOT NULL,
      result jsonb NOT NULL,
      completed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, step_id)
    );

    CREATE TABLE IF NOT EXISTS ${s}.waits (
      run_id uuid NOT NULL REFERENCES ${s}.runs (id) ON DELETE CASCADE,
      tenant_id text NOT NULL,
      step_id text NOT NULL,
      event text,
      wake_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (run_id, step_id)
    );

    CREATE TABLE IF NOT EXISTS ${s}.events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      run_id uuid NOT NULL REFERENCES ${s}.runs (id) ON DELETE CASCADE,
      tenant_id text NOT NULL,
      name text NOT NULL,
      data jsonb NOT NULL,
      consumed_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS events_unconsumed ON ${s}.events (run_id, name, id) WHERE consumed_by IS NULL;
  `;
}

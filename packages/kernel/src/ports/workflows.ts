import type { Instant } from "../dates";
import type { TenantContext, TenantId } from "../tenant";

/** Structural so zod schemas fit without the kernel depending on zod. */
export interface WorkflowSchema<T> {
  parse(value: unknown): T;
}

/** A human duration such as `"1 day"` or `"2 hours 30 minutes"`, or its parts. */
export type WorkflowDuration =
  | string
  | { days?: number; hours?: number; minutes?: number; seconds?: number };

export interface WaitForOptions<T> {
  timeout?: WorkflowDuration;
  schema?: WorkflowSchema<T>;
  /** Defaults to the event name; set it when a workflow waits for the same event twice. */
  stepId?: string;
}

/**
 * Durable steps. A run is replayed from the top after every pause or restart, so anything with a
 * side effect or a non-deterministic result (time, ids, I/O) must happen inside `run`.
 */
export interface WorkflowStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  delay(id: string, duration: WorkflowDuration): Promise<void>;
  waitFor<T = Record<string, unknown>>(
    event: string,
    options: WaitForOptions<T> & { timeout: WorkflowDuration },
  ): Promise<T | undefined>;
  waitFor<T = Record<string, unknown>>(
    event: string,
    options?: Omit<WaitForOptions<T>, "timeout">,
  ): Promise<T>;
}

export interface WorkflowContext<Input> {
  readonly input: Input;
  readonly tenantId: TenantId;
  readonly runId: string;
  readonly step: WorkflowStep;
}

/** What callers need to start a workflow, without importing its handler. */
export interface WorkflowRef<Input = unknown> {
  readonly id: string;
  readonly input: WorkflowSchema<Input>;
}

export interface WorkflowDefinition<Input = unknown, Output = unknown> extends WorkflowRef<Input> {
  readonly retries?: number;
  run(context: WorkflowContext<Input>): Promise<Output>;
}

export function workflowRef<Input>(id: string, input: WorkflowSchema<Input>): WorkflowRef<Input> {
  return { id, input };
}

export function defineWorkflow<Input, Output>(
  ref: WorkflowRef<Input>,
  run: (context: WorkflowContext<Input>) => Promise<Output>,
  options: { retries?: number } = {},
): WorkflowDefinition<Input, Output> {
  return { ...ref, ...options, run };
}

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkflowRunState {
  readonly runId: string;
  readonly workflowId: string;
  readonly status: WorkflowRunStatus;
  readonly currentStep: string;
  readonly output: unknown;
  readonly error: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: Instant;
  readonly completedAt: Instant | null;
}

export interface StartWorkflowOptions {
  /** Starting twice with the same key returns the existing run. */
  idempotencyKey?: string;
  /** What the run is about, as `workflowSubject` tags, so lifecycle changes can find it. */
  subjects?: readonly string[];
}

export const workflowSubject = (type: string, id: string): string => `${type}:${id}`;

/** Long-running coordination (journeys, renewals, notices). Every run belongs to one tenant. */
export interface Workflows {
  start<Input>(
    ctx: TenantContext,
    workflow: WorkflowRef<Input>,
    input: Input,
    options?: StartWorkflowOptions,
  ): Promise<{ runId: string }>;
  signal(
    ctx: TenantContext,
    runId: string,
    event: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
  cancel(ctx: TenantContext, runId: string, reason?: string): Promise<void>;
  status(ctx: TenantContext, runId: string): Promise<WorkflowRunState>;
}

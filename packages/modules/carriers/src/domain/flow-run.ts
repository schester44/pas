import type { Id, Instant, TenantId } from "@pas/kernel";
import type { CarrierEnvironment, CarrierId } from "./carrier";
import type { CanonicalInput, FlowSubject } from "./canonical";
import type { Capability } from "./connector";
import type { CarrierOutcome } from "./outcome";

export type FlowRunId = Id<"CarrierFlowRun">;
export type FlowRunStatus = "running" | "waiting" | "succeeded" | "failed";
export type FlowRunMode = "live" | "test";

export interface FlowRunOutput {
  outcome: CarrierOutcome;
  failedStep: string | null;
  compensated: string[];
  steps: Record<string, unknown>;
}

export interface FlowRun {
  id: FlowRunId;
  tenantId: TenantId;
  carrierId: CarrierId;
  connectionId: string | null;
  connectorVersionId: string | null;
  connectorVersion: number | null;
  capability: Capability;
  subject: FlowSubject;
  mode: FlowRunMode;
  environment: CarrierEnvironment;
  status: FlowRunStatus;
  input: CanonicalInput;
  output: FlowRunOutput | null;
  error: string | null;
  workflowRunId: string | null;
  startedAt: Instant;
  updatedAt: Instant;
  completedAt: Instant | null;
}

export interface Exchange {
  id: string;
  flowRunId: string;
  execId: string;
  stepId: string;
  kind: "request" | "poll" | "callback" | "compensation";
  attempt: number;
  request: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown } | null;
  ok: boolean;
  error: string | null;
  durationMs: number;
  occurredAt: Instant;
}

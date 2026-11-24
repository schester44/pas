import type { ExtensionPoint } from "@pas/extension-points";
import type { Id, Instant, TenantId } from "@pas/kernel";
import type { ExtensionId } from "./extension";
import type { RecordedExchange } from "./test-case";
import type { ExtensionVersionId } from "./version";

export type ExtensionRunId = Id<"ExtensionRun">;
export type RunStatus = "succeeded" | "failed" | "invalid_output";
export type RunTrigger = "live" | "test";

export interface ExtensionRun {
  id: ExtensionRunId;
  tenantId: TenantId;
  extensionId: ExtensionId;
  extensionVersionId: ExtensionVersionId | null;
  version: number | null;
  point: ExtensionPoint;
  trigger: RunTrigger;
  subject: { type: string; id: string } | null;
  status: RunStatus;
  error: { code: string; message: string } | null;
  input: unknown;
  output: unknown;
  network: RecordedExchange[];
  logs: { level: string; message: string }[];
  stats: { cpuMs: number; wallMs: number; hostCalls: number };
  createdAt: Instant;
}

import type { HostFunctions } from "./client/host";
import type { InvocationResult, SandboxLimits } from "./protocol";

export {
  defaultSandboxLimits,
  sandboxErrorCodes,
  type InvocationResult,
  type InvocationStats,
  type LogEntry,
  type SandboxErrorCode,
  type SandboxLimits,
} from "./protocol";
export type { HostFunctions } from "./client/host";
export type { ExtensionContext, ExtensionResponse } from "./sdk";

export interface InvokeRequest {
  tenantId: string;
  /** The compiled extension bundle (an ES module). */
  code: string;
  /** Exported function to call; defaults to `default`. */
  entry?: string;
  input: unknown;
  host?: HostFunctions;
  limits?: Partial<SandboxLimits>;
  invocationId?: string;
  signal?: AbortSignal;
}

/** Runs tenant extension code somewhere it can't reach the caller's resources. */
export interface ExtensionSandbox {
  invoke(request: InvokeRequest): Promise<InvocationResult>;
}

import type { Clock, TenantContext, WorkflowStep } from "@pas/kernel";
import type { SealedSecret } from "../domain/secret";
import type { RecordedExchange } from "../domain/test-case";

export interface SecretBox {
  seal(plaintext: string, context: string): SealedSecret;
  open(sealed: SealedSecret, context: string): string;
}

export type CompileResult =
  | { ok: true; code: string; exports: string[]; warnings: string[] }
  | { ok: false; issues: string[] };

/** Publish-time: TypeScript files → one self-contained ES module. */
export interface ExtensionCompiler {
  compile(files: Record<string, string>, entry: string): Promise<CompileResult>;
}

export type NetworkMode = "live" | "fixtures" | "record";

/** Host functions beyond fetch/clock/step, keyed by SDK name (the automation PAS SDK). */
export type HostServices = Record<string, (args: unknown) => Promise<unknown>>;

export interface RunnerRequest {
  ctx: TenantContext;
  invocationId: string;
  code: string;
  entry: string;
  input: unknown;
  limits: { memoryMb?: number; cpuMs?: number; wallMs: number };
  network: {
    mode: NetworkMode;
    allowedHosts: string[];
    credentials: { host: string; header: string; value: string }[];
    fixtures: RecordedExchange[];
  };
  clock: Clock;
  step?: WorkflowStep;
  services?: HostServices;
  signal?: AbortSignal;
}

export interface RunnerResult {
  ok: boolean;
  output: unknown;
  error: { code: string; message: string } | null;
  logs: { level: string; message: string }[];
  stats: { cpuMs: number; wallMs: number; hostCalls: number };
  network: RecordedExchange[];
}

/** Runs extension code in the sandbox service; never in this process. */
export interface ExtensionRunner {
  run(request: RunnerRequest): Promise<RunnerResult>;
}

export interface ExtensionEnvironments {
  isSandbox(ctx: TenantContext): Promise<boolean>;
}

/** Builds the PAS SDK host functions for one automation run, limited to what it declared. */
export interface AutomationServices {
  build(ctx: TenantContext, granted: readonly string[], context: { runId: string }): HostServices;
}

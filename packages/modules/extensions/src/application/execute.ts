import {
  type ExtensionPoint,
  parsePointOutput,
  type PointOutputs,
  type RunSubject,
} from "@pas/extension-points";
import { newId, type TenantContext, toPlainJson, type WorkflowStep } from "@pas/kernel";
import type { ExtensionId } from "../domain/extension";
import { exportNameFor, type ExtensionManifest, renderCredential } from "../domain/manifest";
import type { ExtensionRun, RunTrigger } from "../domain/run";
import { secretContext } from "../domain/secret";
import type { RecordedExchange } from "../domain/test-case";
import type { ExtensionVersionId } from "../domain/version";
import type { HostServices, NetworkMode } from "../ports/services";
import type { ExtensionDeps } from "./deps";

export interface Execution {
  extensionId: ExtensionId;
  extensionVersionId: ExtensionVersionId | null;
  version: number | null;
  code: string;
  manifest: ExtensionManifest;
  point: ExtensionPoint;
  input: unknown;
  wallMs: number;
  network: NetworkMode;
  fixtures: RecordedExchange[];
  trigger: RunTrigger;
  subject?: RunSubject;
  step?: WorkflowStep;
  services?: HostServices;
}

export type ExecutionResult<P extends ExtensionPoint> =
  | { ok: true; output: PointOutputs[P]; run: ExtensionRun }
  | { ok: false; error: { code: string; message: string }; run: ExtensionRun };

/** Which network an invocation gets: sandbox tenants answer from fixtures unless the extension opts in. */
export async function networkModeFor(
  deps: Pick<ExtensionDeps, "environments">,
  ctx: TenantContext,
  manifest: ExtensionManifest,
): Promise<NetworkMode> {
  if (manifest.liveInSandbox) return "live";

  return (await deps.environments.isSandbox(ctx)) ? "fixtures" : "live";
}

async function credentialsFor(
  deps: Pick<ExtensionDeps, "uow" | "extensions" | "secrets">,
  ctx: TenantContext,
  extensionId: ExtensionId,
  manifest: ExtensionManifest,
) {
  if (manifest.credentials.length === 0) return [];

  const stored = await deps.uow.run(ctx, (tx) => deps.extensions.secrets(tx, ctx, extensionId));

  const values = Object.fromEntries(
    stored.map((s) => [
      s.name,
      deps.secrets.open(s.sealed, secretContext(ctx.tenantId, extensionId, s.name)),
    ]),
  );

  return manifest.credentials.map((rule) => ({
    host: rule.host,
    header: rule.header,
    value: renderCredential(rule.value, values),
  }));
}

/** Runs one invocation in the sandbox, checks its output against the point and logs the run. */
export async function execute<P extends ExtensionPoint>(
  deps: Pick<ExtensionDeps, "uow" | "extensions" | "secrets" | "runner" | "runs" | "clocks">,
  ctx: TenantContext,
  execution: Execution & { point: P },
): Promise<ExecutionResult<P>> {
  const clock = deps.clocks.forTenant(ctx.tenantId);
  const runId = newId<"ExtensionRun">();

  const result = await deps.runner.run({
    ctx,
    invocationId: runId,
    code: execution.code,
    entry: exportNameFor(execution.point),
    input: execution.input,
    limits: { ...execution.manifest.limits, wallMs: execution.wallMs },
    network: {
      mode: execution.network,
      allowedHosts: execution.manifest.allowedHosts,
      credentials: await credentialsFor(deps, ctx, execution.extensionId, execution.manifest),
      fixtures: execution.fixtures,
    },
    clock,
    ...(execution.step && { step: execution.step }),
    ...(execution.services && { services: execution.services }),
  });

  const parsed = result.ok ? parsePointOutput(execution.point, result.output) : null;

  const error =
    result.error ??
    (parsed && !parsed.ok
      ? {
          code: "invalid_output",
          message: `The output doesn't fit ${execution.point}: ${parsed.issues.join("; ")}`,
        }
      : null);

  const run: ExtensionRun = {
    id: runId,
    tenantId: ctx.tenantId,
    extensionId: execution.extensionId,
    extensionVersionId: execution.extensionVersionId,
    version: execution.version,
    point: execution.point,
    trigger: execution.trigger,
    subject: execution.subject ?? null,
    status: result.ok ? (error ? "invalid_output" : "succeeded") : "failed",
    error,
    input: toPlainJson(execution.input),
    output: result.ok ? toPlainJson(result.output) : null,
    network: result.network,
    logs: result.logs,
    stats: result.stats,
    createdAt: clock.now(),
  };

  await deps.uow.run(ctx, (tx) => deps.runs.insert(tx, run));

  if (parsed?.ok) return { ok: true, output: parsed.value, run };

  return {
    ok: false,
    error: error ?? { code: "extension_error", message: "The extension failed" },
    run,
  };
}

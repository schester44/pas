import {
  type ExtensionPoint,
  POINT_SPECS,
  type PointOutputs,
  type RunSubject,
} from "@pas/extension-points";
import { asId, DomainError, type TenantContext, type WorkflowStep } from "@pas/kernel";
import type { ExtensionVersion } from "../domain/version";
import type { HostServices } from "../ports/services";
import type { ExtensionDeps } from "./deps";
import { type ExecutionResult, execute, networkModeFor } from "./execute";

const MAX_CACHED_VERSIONS = 500;

export interface RunExtensionInput<P extends ExtensionPoint> {
  extensionVersionId: string;
  point: P;
  input: unknown;
  timeoutMs?: number;
  subject?: RunSubject;
  step?: WorkflowStep;
  services?: HostServices;
  signal?: AbortSignal;
}

/** Runs a published version; versions are immutable, so they're cached by id. */
export function makeRunExtension(
  deps: Pick<
    ExtensionDeps,
    "uow" | "extensions" | "secrets" | "runner" | "runs" | "clocks" | "environments"
  >,
) {
  const cache = new Map<string, ExtensionVersion>();

  async function versionFor(ctx: TenantContext, id: string): Promise<ExtensionVersion> {
    const key = `${ctx.tenantId}:${id}`;
    const cached = cache.get(key);

    if (cached) return cached;

    const version = await deps.uow.run(ctx, (tx) => deps.extensions.findVersion(tx, ctx, asId(id)));

    if (!version) {
      throw new DomainError("precondition_failed", `Extension version ${id} doesn't exist`, {
        reason: "extension_version_missing",
      });
    }

    if (cache.size >= MAX_CACHED_VERSIONS) cache.delete(cache.keys().next().value!);

    cache.set(key, version);

    return version;
  }

  return async function runExtension<P extends ExtensionPoint>(
    ctx: TenantContext,
    input: RunExtensionInput<P>,
  ): Promise<ExecutionResult<P>> {
    const version = await versionFor(ctx, input.extensionVersionId);

    if (!version.manifest.points.includes(input.point)) {
      throw new DomainError(
        "precondition_failed",
        `Extension version ${version.version} doesn't implement ${input.point}`,
        { reason: "point_not_implemented" },
      );
    }

    const spec = POINT_SPECS[input.point];

    return execute(deps, ctx, {
      extensionId: version.extensionId,
      extensionVersionId: version.id,
      version: version.version,
      code: version.code,
      manifest: version.manifest,
      point: input.point,
      input: input.input,
      wallMs: Math.min(input.timeoutMs ?? spec.defaultTimeoutMs, spec.maxTimeoutMs),
      network: await networkModeFor(deps, ctx, version.manifest),
      fixtures: version.tests.flatMap((t) => t.network),
      trigger: "live",
      ...(input.subject && { subject: input.subject }),
      ...(input.step && { step: input.step }),
      ...(input.services && { services: input.services }),
      ...(input.signal && { signal: input.signal }),
    });
  };
}

export type RunExtension = ReturnType<typeof makeRunExtension>;
export type RunOutput<P extends ExtensionPoint> = PointOutputs[P];

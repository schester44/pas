import type { TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";
import type { RunExtension } from "./run-extension";

const POINT = "enrichment_transform" as const;

export interface TransformReference {
  key: string;
  /** A published version number as text; absent means the latest one. */
  version?: string;
}

/**
 * Enrichment plans name transforms by extension key; catalog pins the version at publish. This
 * resolves a key (and optional version) to a published version that implements the point.
 */
export function makeResolveTransform(deps: Pick<ExtensionDeps, "uow" | "extensions">) {
  return async function resolveTransform(ctx: TenantContext, ref: TransformReference) {
    return deps.uow.run(ctx, async (tx) => {
      const extension = await deps.extensions.findByKey(tx, ctx, ref.key);

      if (!extension) return null;

      const versions = (await deps.extensions.versions(tx, ctx, extension.id)).filter((v) =>
        v.manifest.points.includes(POINT),
      );

      const chosen = ref.version
        ? versions.find((v) => String(v.version) === ref.version)
        : versions.toSorted((a, b) => b.version - a.version)[0];

      return chosen ? { versionId: chosen.id as string, version: String(chosen.version) } : null;
    });
  };
}

export type ResolveTransform = ReturnType<typeof makeResolveTransform>;

type TransformRun =
  | { ok: true; values: Record<string, unknown>; logs: string[] }
  | { ok: false; error: string; logs: string[] };

/** The enrichment engine's transform runner, over the same run path as every other point. */
export function makeEnrichmentTransforms(deps: {
  resolve: ResolveTransform;
  runExtension: RunExtension;
}) {
  return {
    for(ctx: TenantContext) {
      return {
        async run(
          transform: { id: string; extension: TransformReference; timeoutMs: number },
          input: {
            sources: Readonly<Record<string, unknown>>;
            risk: Readonly<Record<string, unknown>>;
          },
          options: { signal: AbortSignal },
        ): Promise<TransformRun> {
          const resolved = await deps.resolve(ctx, transform.extension);
          const ref = `${transform.extension.key}${transform.extension.version ? ` v${transform.extension.version}` : ""}`;

          if (!resolved) {
            return {
              ok: false,
              error: `No published ${ref} implements enrichment transforms`,
              logs: [],
            };
          }

          const result = await deps.runExtension(ctx, {
            extensionVersionId: resolved.versionId,
            point: POINT,
            input,
            timeoutMs: transform.timeoutMs,
            subject: { type: "enrichment_transform", id: transform.id },
            signal: options.signal,
          });

          const logs = result.run.logs.map((log) => `${log.level}: ${log.message}`);

          return result.ok
            ? { ok: true, values: result.output.values, logs }
            : { ok: false, error: result.error.message, logs };
        },
      };
    },
  };
}

import type { TransformRunner } from "@pas/enrichment";
import type { ClockProvider, TenantContext } from "@pas/kernel";
import type { ExtensionSandbox } from "@pas/sandbox";
import { clockHost } from "@pas/sandbox/client";
import { isRecord } from "@pas/kernel";
import type { TransformExtension, TransformExtensions } from "../ports/enrichment";

/** Installed transforms passed in by a composition root, until the extension store lands. */
export class StaticTransformExtensions implements TransformExtensions {
  constructor(private readonly extensions: readonly TransformExtension[] = []) {}

  async find(tenantId: string, key: string, version?: string) {
    const matching = this.extensions.filter(
      (e) => e.key === key && (!version || e.version === version),
    );

    return matching.at(-1) ?? null;
  }
}

/** Runs transforms in the extension sandbox (`apps/sandbox`); fails closed without one. */
export class SandboxEnrichmentTransforms {
  constructor(
    private readonly deps: {
      sandbox: ExtensionSandbox | null;
      extensions: TransformExtensions;
      clocks: ClockProvider;
    },
  ) {}

  for(ctx: TenantContext): TransformRunner {
    return {
      run: async (transform, input, { signal }) => {
        if (!this.deps.sandbox) {
          return { ok: false, error: "The extension sandbox isn't configured", logs: [] };
        }

        const extension = await this.deps.extensions.find(
          ctx.tenantId,
          transform.extension.key,
          transform.extension.version,
        );

        if (!extension) {
          return {
            ok: false,
            error: `Extension ${transform.extension.key}@${transform.extension.version ?? "latest"} isn't installed`,
            logs: [],
          };
        }

        const result = await this.deps.sandbox.invoke({
          tenantId: ctx.tenantId,
          code: extension.code,
          input,
          host: clockHost(this.deps.clocks.forTenant(ctx.tenantId)),
          limits: { wallMs: transform.timeoutMs },
          signal,
        });

        const logs = result.logs.map((log) => `${log.level}: ${log.message}`);

        if (!result.ok) return { ok: false, error: result.error.message, logs };

        if (!isRecord(result.output)) {
          return { ok: false, error: "The transform must return an object of values", logs };
        }

        return { ok: true, values: result.output, logs };
      },
    };
  }
}

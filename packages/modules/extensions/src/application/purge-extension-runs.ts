import type { TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";

/** Retention: drops a tenant's runs (inputs, outputs, network, logs) older than `days`. */
export function makePurgeExtensionRuns(deps: Pick<ExtensionDeps, "uow" | "runs" | "clocks">) {
  return async function purgeExtensionRuns(
    ctx: TenantContext,
    input: { days: number },
  ): Promise<number> {
    const before = deps.clocks
      .forTenant(ctx.tenantId)
      .now()
      .subtract({ hours: input.days * 24 });

    return deps.uow.run(ctx, (tx) => deps.runs.purgeBefore(tx, ctx, before));
  };
}

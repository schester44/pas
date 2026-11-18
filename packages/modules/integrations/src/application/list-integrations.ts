import type { TenantContext } from "@pas/kernel";
import { type IntegrationDeps } from "./deps";
import { type IntegrationSummaryDto, toSummaryDto } from "./dto";

export function makeListIntegrations(deps: IntegrationDeps) {
  return async function listIntegrations(
    ctx: TenantContext,
  ): Promise<{ sandbox: boolean; integrations: IntegrationSummaryDto[] }> {
    const [installs, powering, sandbox] = await Promise.all([
      deps.uow.run(ctx, (tx) => deps.installs.list(tx, ctx)),
      deps.resolver.powering(ctx),
      deps.resolver.isSandbox(ctx.tenantId),
    ]);

    const byProvider = new Map(installs.map((i) => [i.providerId, i.toSnapshot()]));

    return {
      sandbox,
      integrations: deps.catalog.list().map(({ manifest }) =>
        toSummaryDto(
          manifest,
          byProvider.get(manifest.id),
          (powering.get(manifest.category) ?? []).some((p) => p.providerId === manifest.id),
        ),
      ),
    };
  };
}

export type ListIntegrations = ReturnType<typeof makeListIntegrations>;

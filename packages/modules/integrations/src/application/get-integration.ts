import type { TenantContext } from "@pas/kernel";
import { type IntegrationDeps, packageOf } from "./deps";
import {
  configFields,
  type IntegrationDetailDto,
  maskHint,
  toActivityDto,
  toSummaryDto,
} from "./dto";

export function makeGetIntegration(
  deps: IntegrationDeps & {
    webhookUrl: (install: { id: string; providerId: string }) => string | null;
  },
) {
  return async function getIntegration(
    ctx: TenantContext,
    input: { providerId: string },
  ): Promise<IntegrationDetailDto> {
    const { manifest } = packageOf(deps, input.providerId);

    const [found, activity] = await deps.uow.run(ctx, (tx) =>
      Promise.all([
        deps.installs.find(tx, ctx, manifest.id),
        deps.events.recent(tx, ctx, manifest.id, 20),
      ]),
    );

    const [powering, sandbox] = await Promise.all([
      deps.resolver.powering(ctx),
      deps.resolver.isSandbox(ctx.tenantId),
    ]);

    const install = found?.toSnapshot();
    const active = powering.get(manifest.category) ?? [];

    return {
      ...toSummaryDto(
        manifest,
        install,
        active.some((p) => p.providerId === manifest.id),
      ),
      description: manifest.description,
      capabilities: [...manifest.capabilities],
      supplies: [...(manifest.supplies ?? [])],
      requiresCredentials: manifest.requiresCredentials ?? false,
      docsUrl: manifest.docsUrl,
      sandbox,
      configFields: configFields(manifest.configSchema),
      config: install?.config ?? {},
      secrets: manifest.secrets.map((field) => {
        const hint = install?.secretHints[field.key];

        return {
          key: field.key,
          label: field.label,
          description: field.description ?? null,
          optional: field.optional ?? false,
          hint: install?.secrets[field.key] ? maskHint(hint ?? "") : null,
        };
      }),
      webhook:
        manifest.webhook && install
          ? { url: deps.webhookUrl(install) ?? "", events: [...manifest.webhook.events] }
          : null,
      health: install?.health
        ? {
            checkedAt: install.health.checkedAt.toString(),
            ok: install.health.ok,
            detail: install.health.detail,
          }
        : null,
      poweredBy: active.map((p) => ({
        id: p.providerId,
        name: deps.catalog.get(p.providerId)?.manifest.name ?? p.providerId,
      })),
      activity: activity.map(toActivityDto),
    };
  };
}

export type GetIntegration = ReturnType<typeof makeGetIntegration>;

import type { FilingChannel, FilingChannels } from "@pas/compliance";
import type { TenantContext } from "@pas/kernel";
import type { ProviderResolver } from "../application/provider-resolver";
import type { ProviderCatalog } from "../ports/provider-catalog";
import { testFilingProvider } from "./providers/filing";

/**
 * The compliance port over the tenant's enabled filing channels. Sandboxes always keep the test
 * filing office next to whatever else they enable, so every obligation can be rehearsed.
 */
export function filingChannelsFrom(integrations: {
  resolver: ProviderResolver;
  catalog: ProviderCatalog;
}): FilingChannels {
  async function enabled(ctx: TenantContext): Promise<FilingChannel[]> {
    const chain = (await integrations.resolver.chain(ctx, "filing")).map((c) => c.adapter);
    const sandbox = await integrations.resolver.isSandbox(ctx.tenantId);

    if (!sandbox || chain.some((c) => c.provider === testFilingProvider.manifest.id)) return chain;

    return [
      ...chain,
      testFilingProvider.create({
        installId: null,
        tenantId: ctx.tenantId,
        environment: "test",
        config: {},
        secrets: {},
        webhookUrl: null,
      }),
    ];
  }

  return {
    async serving(ctx, input) {
      const channels = (await enabled(ctx)).filter((c) => c.serves(input.kind, input.jurisdiction));

      return channels.toSorted(
        (a, b) => Number(b.delivery === input.preferred) - Number(a.delivery === input.preferred),
      );
    },
    async byProvider(ctx, providerId) {
      return (await enabled(ctx)).find((c) => c.provider === providerId) ?? null;
    },
  };
}

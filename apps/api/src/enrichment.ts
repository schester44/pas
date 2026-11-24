import type { EnrichmentDirectory } from "@pas/catalog";
import type { Extensions } from "@pas/extensions/infrastructure";
import type { ProviderResolver } from "@pas/integrations";

/** Enrichment transforms are `enrichment_transform` extensions, run like every other point. */
export function composeEnrichmentExtensions(deps: {
  extensions: Extensions;
  resolver: ProviderResolver;
}) {
  const directory: EnrichmentDirectory = {
    providers: async (ctx) =>
      (await deps.resolver.dataProviders.for(ctx)).list().map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        capabilities: manifest.capabilities,
      })),
    extension: async (ctx, key) => {
      const found = await deps.extensions.resolveTransform(ctx, { key });

      return found && { version: found.version };
    },
  };

  return { transforms: deps.extensions.enrichmentTransforms, directory };
}

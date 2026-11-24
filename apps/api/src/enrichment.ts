import type { EnrichmentDirectory } from "@pas/catalog";
import type { ClockProvider } from "@pas/kernel";
import type { ProviderResolver } from "@pas/integrations";
import { HttpSandboxClient } from "@pas/sandbox/client";
import {
  SandboxEnrichmentTransforms,
  StaticTransformExtensions,
} from "@pas/submissions/infrastructure";

/**
 * Enrichment transforms run in apps/sandbox when SANDBOX_URL is set; without it they fail closed.
 * Installed transforms come from a static list until the extension store exists (PLAN §15.1).
 */
export function composeEnrichmentExtensions(deps: {
  clocks: ClockProvider;
  resolver: ProviderResolver;
}) {
  const url = process.env.SANDBOX_URL;

  const sandbox = url
    ? new HttpSandboxClient({ url, token: process.env.SANDBOX_TOKEN ?? "dev-sandbox-token" })
    : null;

  const extensions = new StaticTransformExtensions();
  const transforms = new SandboxEnrichmentTransforms({ sandbox, extensions, clocks: deps.clocks });

  const directory: EnrichmentDirectory = {
    providers: async (ctx) =>
      (await deps.resolver.dataProviders.for(ctx)).list().map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        capabilities: manifest.capabilities,
      })),
    extension: async (ctx, key) => {
      const found = await extensions.find(ctx.tenantId, key);

      return found && { version: found.version, ...(found.writes && { writes: found.writes }) };
    },
  };

  return { transforms, directory };
}

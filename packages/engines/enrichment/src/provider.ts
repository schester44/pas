import type { Money } from "@pas/kernel";
import type { z } from "zod";
import type { ProviderCapability } from "./plan";

export type ProviderRequest = Readonly<Record<string, unknown>>;
export type ProviderResponse = Readonly<Record<string, unknown>>;

export interface ProviderManifest {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly ProviderCapability[];
  readonly configSchema: z.ZodType;
  readonly secrets: readonly string[];
  readonly costPerCall: Money;
  /** FCRA consumer reports (credit, loss history, MVR) need captured consent before a call. */
  readonly consumerReport: boolean;
}

export interface DataProvider {
  readonly manifest: ProviderManifest;
  fetch(
    capability: ProviderCapability,
    request: ProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<ProviderResponse>;
}

export interface ProviderRegistry {
  get(id: string): DataProvider | undefined;
  list(): readonly ProviderManifest[];
  withCapability(capability: ProviderCapability): readonly ProviderManifest[];
}

export function createProviderRegistry(providers: readonly DataProvider[]): ProviderRegistry {
  const byId = new Map<string, DataProvider>();

  for (const provider of providers) {
    if (byId.has(provider.manifest.id)) {
      throw new Error(`Duplicate data provider ${provider.manifest.id}`);
    }

    byId.set(provider.manifest.id, provider);
  }

  const manifests = [...byId.values()].map((provider) => provider.manifest);

  return {
    get: (id) => byId.get(id),
    list: () => manifests,
    withCapability: (capability) =>
      manifests.filter((manifest) => manifest.capabilities.includes(capability)),
  };
}

import { canonicalJson, type Clock, type Instant } from "@pas/kernel";
import type { ProviderCapability } from "./plan";
import type { ProviderRequest, ProviderResponse } from "./provider";

export interface EnrichmentCache {
  get(key: string): Promise<ProviderResponse | undefined>;
  set(key: string, response: ProviderResponse, expiresAt: Instant): Promise<void>;
}

export function enrichmentCacheKey(
  providerId: string,
  capability: ProviderCapability,
  request: ProviderRequest,
): string {
  return `${providerId}:${capability}:${canonicalJson(normalize(request))}`;
}

function normalize(value: unknown): unknown {
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ").toUpperCase();

  if (Array.isArray(value)) return value.map(normalize);

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }

  return value;
}

export class InMemoryEnrichmentCache implements EnrichmentCache {
  private readonly entries = new Map<string, { response: ProviderResponse; expiresAt: Instant }>();

  constructor(private readonly clock: Clock) {}

  async get(key: string): Promise<ProviderResponse | undefined> {
    const entry = this.entries.get(key);

    if (!entry) return undefined;

    if (Temporal.Instant.compare(entry.expiresAt, this.clock.now()) <= 0) {
      this.entries.delete(key);

      return undefined;
    }

    return entry.response;
  }

  async set(key: string, response: ProviderResponse, expiresAt: Instant): Promise<void> {
    this.entries.set(key, { response, expiresAt });
  }
}

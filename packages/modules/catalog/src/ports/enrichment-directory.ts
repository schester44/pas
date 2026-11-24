import type { TenantContext } from "@pas/kernel";

/** What enrichment plans may name: the tenant's data providers and transform extensions. */
export interface EnrichmentDirectory {
  providers(
    ctx: TenantContext,
  ): Promise<{ id: string; name: string; capabilities: readonly string[] }[]>;
  /** The installed `enrichment_transform` extension's current version, or null when there's none. */
  extension(
    ctx: TenantContext,
    key: string,
  ): Promise<{ version: string; writes?: readonly string[] } | null>;
}

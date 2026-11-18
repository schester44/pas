import type { TenantContext } from "@pas/kernel";
import type { CatalogRelease } from "./product-catalog";

export type QuoteEnrichmentStage = "prefill" | "pre_rate";

export interface EnrichedRisk {
  risk: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
}

/** Runs the release's enrichment plan stages; returns the risk untouched when there's no plan. */
export interface RiskEnricher {
  enrich(
    ctx: TenantContext,
    release: CatalogRelease,
    risk: Record<string, unknown>,
    stages: readonly QuoteEnrichmentStage[],
  ): Promise<EnrichedRisk>;
}

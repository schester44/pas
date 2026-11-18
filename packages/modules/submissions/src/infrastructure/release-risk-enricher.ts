import type { TenantContext } from "@pas/kernel";
import type { CatalogRelease } from "../ports/product-catalog";
import type { EnrichedRisk, QuoteEnrichmentStage, RiskEnricher } from "../ports/risk-enricher";

/** Releases don't carry an EnrichmentPlan yet, so the risk passes through as entered. */
export class PassThroughRiskEnricher implements RiskEnricher {
  async enrich(
    _ctx: TenantContext,
    _release: CatalogRelease,
    risk: Record<string, unknown>,
    _stages: readonly QuoteEnrichmentStage[],
  ): Promise<EnrichedRisk> {
    return { risk, snapshot: null };
  }
}

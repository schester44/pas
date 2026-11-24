import type { TenantContext } from "@pas/kernel";
import type { QuoteEnrichment } from "../domain/enrichment";
import type { CatalogRelease } from "./product-catalog";

export type QuoteEnrichmentStage = "prefill" | "pre_rate";

export interface EnrichedRisk {
  /** The risk with enrichment applied; what underwriting, decisions and rating read. */
  risk: Record<string, unknown>;
  enrichment: QuoteEnrichment | null;
}

/** Runs the release's enrichment plan stages; returns the risk untouched when there's no plan. */
export interface RiskEnricher {
  enrich(
    ctx: TenantContext,
    release: CatalogRelease,
    risk: Record<string, unknown>,
    stages: readonly QuoteEnrichmentStage[],
    /** Records are kept and reused per submission; without one, nothing is stored. */
    submissionId?: string,
  ): Promise<EnrichedRisk>;
}

/** For rating issued terms: their risk already holds the enrichment applied at bind (rule 5). */
export const noEnrichment: RiskEnricher = {
  enrich: async (_ctx, _release, risk) => ({ risk, enrichment: null }),
};

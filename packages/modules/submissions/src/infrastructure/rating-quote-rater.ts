import type { TenantContext } from "@pas/kernel";
import type { RateRisk } from "@pas/rating";
import type { RaterSource, RatingInput, RatingResult } from "@pas/rating-engine";
import type { QuoteRater } from "../ports/quote-rater";

export class RatingModuleQuoteRater implements QuoteRater {
  constructor(private readonly rateRisk: RateRisk) {}

  rate(
    ctx: TenantContext,
    input: { releaseId: string; source: RaterSource; input: RatingInput },
  ): Promise<RatingResult> {
    return this.rateRisk(ctx, {
      cacheKey: input.releaseId,
      source: input.source,
      input: input.input,
    });
  }
}

import type { TenantContext } from "@pas/kernel";
import type { RaterSource, RatingInput, RatingResult } from "@pas/rating-engine";

/** Prices a risk with the release's rater (plan or spreadsheet); throws a RatingError when it can't. */
export interface QuoteRater {
  rate(
    ctx: TenantContext,
    input: { releaseId: string; source: RaterSource; input: RatingInput },
  ): Promise<RatingResult>;
}

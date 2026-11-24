import type { TenantContext } from "@pas/kernel";
import type { Rater, RaterSource, RatingInput, RatingResult } from "@pas/rating-engine";
import type { ExtensionRaterRunner } from "../ports/extension-rater";
import { buildRater, workbookFor } from "./build-rater";
import type { WorkbookModels } from "./workbook-models";

const MAX_CACHED_RATERS = 200;

/** Rates against an immutable rater source; `cacheKey` must identify that source (a release id). */
export function makeRateRisk(deps: { models: WorkbookModels; extensions?: ExtensionRaterRunner }) {
  const raters = new Map<string, Rater>();

  async function raterFor(ctx: TenantContext, cacheKey: string, source: RaterSource) {
    if (source.engine === "extension") {
      return buildRater(source, null, {
        ctx,
        ...(deps.extensions && { extensions: deps.extensions }),
      });
    }

    const key = `${ctx.tenantId}:${cacheKey}`;
    const cached = raters.get(key);

    if (cached) return cached;

    const rater = buildRater(source, await workbookFor(deps.models, ctx, source));

    if (raters.size >= MAX_CACHED_RATERS) raters.delete(raters.keys().next().value!);

    raters.set(key, rater);

    return rater;
  }

  return async function rateRisk(
    ctx: TenantContext,
    input: { cacheKey: string; source: RaterSource; input: RatingInput },
  ): Promise<RatingResult> {
    const rater = await raterFor(ctx, input.cacheKey, input.source);

    return rater.rate(input.input);
  };
}

export type RateRisk = ReturnType<typeof makeRateRisk>;

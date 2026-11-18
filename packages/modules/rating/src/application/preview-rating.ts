import type { TenantContext } from "@pas/kernel";
import type { RaterSource, RatingInput, RatingResultJson } from "@pas/rating-engine";
import { buildRater, workbookFor } from "./build-rater";
import type { WorkbookModels } from "./workbook-models";

export type RatingPreviewDto =
  | { status: "ok"; result: RatingResultJson }
  | { status: "error"; message: string; details?: unknown };

export function makePreviewRating(deps: { models: WorkbookModels }) {
  return async function previewRating(
    ctx: TenantContext,
    input: { rating: RaterSource; input: RatingInput },
  ): Promise<RatingPreviewDto> {
    try {
      const rater = buildRater(input.rating, await workbookFor(deps.models, ctx, input.rating));
      const result = await rater.rate(input.input);

      return { status: "ok", result: JSON.parse(JSON.stringify(result)) as RatingResultJson };
    } catch (error) {
      const details = (error as { details?: unknown }).details;

      return {
        status: "error",
        message: (error as Error).message,
        ...(details !== undefined && { details }),
      };
    }
  };
}

export type PreviewRating = ReturnType<typeof makePreviewRating>;

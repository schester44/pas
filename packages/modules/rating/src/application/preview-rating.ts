import { isRecord, type MessageParams, toPlainJson, type TenantContext } from "@pas/kernel";
import type { RaterSource, RatingInput, RatingResultJson } from "@pas/rating-engine";
import { buildRater, workbookFor } from "./build-rater";
import type { WorkbookModels } from "./workbook-models";

export type RatingPreviewDto =
  | { status: "ok"; result: RatingResultJson }
  | { status: "error"; message: string; params?: MessageParams; details?: unknown };

function failure(error: unknown): Extract<RatingPreviewDto, { status: "error" }> {
  const details = (error as { details?: unknown }).details;
  const message = (error as Error).message;

  if (
    isRecord(details) &&
    typeof details.coverage === "string" &&
    typeof details.step === "string" &&
    typeof details.reason === "string"
  ) {
    return {
      status: "error",
      message: `{coverage}, ${details.step}: ${details.reason}`,
      params: { coverage: { kind: "coverage", code: details.coverage } },
      details,
    };
  }

  return { status: "error", message, ...(details !== undefined && { details }) };
}

export function makePreviewRating(deps: { models: WorkbookModels }) {
  return async function previewRating(
    ctx: TenantContext,
    input: { rating: RaterSource; input: RatingInput },
  ): Promise<RatingPreviewDto> {
    try {
      const rater = buildRater(input.rating, await workbookFor(deps.models, ctx, input.rating));
      const result = await rater.rate(input.input);

      return { status: "ok", result: toPlainJson(result) as unknown as RatingResultJson };
    } catch (error) {
      return failure(error);
    }
  };
}

export type PreviewRating = ReturnType<typeof makePreviewRating>;

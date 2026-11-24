import type { RiskSchema } from "@pas/forms-core";
import type { TenantContext } from "@pas/kernel";
import { type GoldenReport, type RatingConfig, runGoldenCases } from "@pas/rating-engine";
import { goldenIssues, type RatingIssue, staticIssues } from "../domain/rating-issues";
import type { ExtensionRaterRunner } from "../ports/extension-rater";
import { buildRater, workbookFor } from "./build-rater";
import type { WorkbookModels } from "./workbook-models";

export interface CheckRatingInput {
  rating: RatingConfig | null;
  riskSchema: RiskSchema;
  coverageCodes: string[];
}

export interface RatingCheckDto {
  issues: RatingIssue[];
  golden: GoldenReport | null;
}

export function makeCheckRating(deps: {
  models: WorkbookModels;
  extensions?: ExtensionRaterRunner;
}) {
  return async function checkRating(
    ctx: TenantContext,
    input: CheckRatingInput,
  ): Promise<RatingCheckDto> {
    const { rating } = input;
    const workbook = rating ? await workbookFor(deps.models, ctx, rating) : null;
    const issues = staticIssues(rating, input.riskSchema, input.coverageCodes, workbook);

    if (!rating || rating.goldenCases.length === 0) return { issues, golden: null };

    let golden: GoldenReport;

    try {
      golden = await runGoldenCases(
        buildRater(rating, workbook, {
          ctx,
          ...(deps.extensions && { extensions: deps.extensions }),
        }),
        rating.goldenCases,
      );
    } catch {
      return { issues, golden: null };
    }

    return { issues: [...issues, ...goldenIssues(rating, golden)], golden };
  };
}

export type CheckRating = ReturnType<typeof makeCheckRating>;

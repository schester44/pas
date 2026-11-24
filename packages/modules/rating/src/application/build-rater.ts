import type { TenantContext } from "@pas/kernel";
import {
  createPlanRater,
  createSpreadsheetRater,
  type Rater,
  type RaterSource,
  RatingError,
  type WorkbookModel,
} from "@pas/rating-engine";
import { ratingResultFromExtension } from "../domain/extension-rating";
import type { ExtensionRaterRunner } from "../ports/extension-rater";
import type { WorkbookModels } from "./workbook-models";

export async function workbookFor(
  models: WorkbookModels,
  ctx: TenantContext,
  source: RaterSource,
): Promise<WorkbookModel | null> {
  if (source.engine !== "spreadsheet" || !source.workbookId) return null;

  return (await models(ctx, source.workbookId))?.model ?? null;
}

export interface RaterRuntime {
  ctx: TenantContext;
  extensions?: ExtensionRaterRunner;
}

/** Throws a RatingError when the source can't be compiled or bound. */
export function buildRater(
  source: RaterSource,
  workbook: WorkbookModel | null,
  runtime?: RaterRuntime,
): Rater {
  if (source.engine === "plan") return createPlanRater(source.plan);

  if (source.engine === "extension") {
    const runner = runtime?.extensions;

    if (!runner || !runtime) throw new RatingError("Extension raters can't run here");

    return {
      artifact: {
        kind: "extension",
        key: source.extensionVersionId,
        version: source.extensionVersionId,
      },
      rate: async (input) =>
        ratingResultFromExtension(source, input, await runner.rate(runtime.ctx, source, input)),
    };
  }

  if (!workbook) throw new Error("Choose a rater workbook first");

  return createSpreadsheetRater(workbook, source.manifest);
}

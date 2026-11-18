import type { TenantContext } from "@pas/kernel";
import {
  createPlanRater,
  createSpreadsheetRater,
  type Rater,
  type RaterSource,
  type WorkbookModel,
} from "@pas/rating-engine";
import type { WorkbookModels } from "./workbook-models";

export async function workbookFor(
  models: WorkbookModels,
  ctx: TenantContext,
  source: RaterSource,
): Promise<WorkbookModel | null> {
  if (source.engine !== "spreadsheet" || !source.workbookId) return null;

  return (await models(ctx, source.workbookId))?.model ?? null;
}

/** Throws a RatingError when the source can't be compiled or bound. */
export function buildRater(source: RaterSource, workbook: WorkbookModel | null): Rater {
  if (source.engine === "plan") return createPlanRater(source.plan);

  if (!workbook) throw new Error("Choose a rater workbook first");

  return createSpreadsheetRater(workbook, source.manifest);
}

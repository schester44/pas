// Packages type-check this engine from source, so its vendor declarations travel with the entry.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./spreadsheet/vendor.d.ts" />

export * from "./config";
export * from "./contract";
export { CONTEXT_ROOTS, type RatingContext } from "./context";
export * from "./golden";
export * from "./serialize";
export type * from "./plan/schema";
export { ratingPlanSchema, rateTableSchema } from "./plan/schema";
export { checkRatingPlan, type PathResolver, type PlanIssue } from "./plan/check";
export { compileRatingPlan, createPlanRater, type CompiledRatingPlan } from "./plan/compile";
export { parseCsv, rateTableFromCsv, type CsvTableOptions } from "./plan/csv";
export type * from "./spreadsheet/model";
export type * from "./spreadsheet/manifest";
export { bindingManifestSchema, checkBindingManifest } from "./spreadsheet/manifest";
export { formatRange, type SheetRange } from "./spreadsheet/address";
export { loadWorkbook, type LoadedWorkbook } from "./spreadsheet/workbook";
export { RecalcSession, WorkbookEngine } from "./spreadsheet/engine";
export { warmEngine } from "./spreadsheet/warm";
export { createSpreadsheetRater } from "./spreadsheet/rater";
export { BLOCKED_FUNCTIONS, SUPPORTED_FUNCTIONS, functionSupport } from "./spreadsheet/functions";

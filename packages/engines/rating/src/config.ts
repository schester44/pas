import type { CurrencyCode } from "@pas/kernel";
import type { GoldenCase } from "./golden";
import type { RatingPlan } from "./plan/schema";
import type { BindingManifest } from "./spreadsheet/manifest";

export type RaterSource =
  | { engine: "plan"; plan: RatingPlan }
  | { engine: "spreadsheet"; workbookId: string | null; manifest: BindingManifest }
  /** A tenant extension's `rate` export (PLAN §15.1); the version id pins the code. */
  | { engine: "extension"; extensionVersionId: string; currency: CurrencyCode; timeoutMs?: number };

export type RatingEngineKind = RaterSource["engine"];

export interface ConfiguredGoldenCase extends GoldenCase {
  id: string;
}

/** What a product version carries for rating: the rater source plus the golden cases it must pass. */
export type RatingConfig = RaterSource & { goldenCases: ConfiguredGoldenCase[] };

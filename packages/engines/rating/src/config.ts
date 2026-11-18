import type { GoldenCase } from "./golden";
import type { RatingPlan } from "./plan/schema";
import type { BindingManifest } from "./spreadsheet/manifest";

export type RaterSource =
  | { engine: "plan"; plan: RatingPlan }
  | { engine: "spreadsheet"; workbookId: string | null; manifest: BindingManifest };

export type RatingEngineKind = RaterSource["engine"];

export interface ConfiguredGoldenCase extends GoldenCase {
  id: string;
}

/** What a product version carries for rating: the rater source plus the golden cases it must pass. */
export type RatingConfig = RaterSource & { goldenCases: ConfiguredGoldenCase[] };

import type { RiskSchema } from "@pas/forms-core";
import type { TenantContext } from "@pas/kernel";
import type { RatingConfig } from "@pas/rating-engine";

export type RatingSection = "engine" | "tables" | "algorithms" | "workbook" | "manifest" | "golden";

export interface RatingTarget {
  section: RatingSection;
  coverage?: string;
  table?: string;
  step?: string;
  golden?: string;
  property?: string;
}

export interface RatingIssue {
  severity: "error" | "warning";
  message: string;
  target: RatingTarget;
}

/** Static checks and golden cases for a version's rater (owned by the rating context). */
export interface RatingVerifier {
  verify(
    ctx: TenantContext,
    input: { rating: RatingConfig | null; riskSchema: RiskSchema; coverageCodes: string[] },
  ): Promise<RatingIssue[]>;
}

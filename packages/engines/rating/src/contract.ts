import { DomainError, type CurrencyCode, type Money } from "@pas/kernel";

export type TransactionType =
  | "NEW_BUSINESS"
  | "ENDORSEMENT"
  | "CANCELLATION"
  | "CANCELLATION_RESCISSION"
  | "REINSTATEMENT"
  | "RENEWAL"
  | "REWRITE"
  | "AUDIT";

export type Scalar = string | number | boolean | null;

export interface CoverageSelection {
  coverage: string;
  exposure?: string;
  limit?: string;
  deductible?: string;
  options?: Record<string, Scalar>;
}

/** Plain JSON so it can cross a worker_threads boundary: dates are ISO strings, amounts decimal strings. */
export interface RatingInput {
  risk: Record<string, unknown>;
  coverages: CoverageSelection[];
  term: { effective: string; expiration: string };
  transaction: { type: TransactionType; effective: string };
  enrichment?: Record<string, unknown>;
  jurisdiction: { country: string; subdivision?: string };
  currency: CurrencyCode;
}

export interface CoveragePremium {
  coverage: string;
  exposure?: string;
  premium: Money;
  calculated: Money;
}

export interface MinimumPremiumAdjustment {
  scope: "coverage" | "policy";
  coverage?: string;
  exposure?: string;
  minimum: Money;
  adjustment: Money;
}

export interface RatingFactor {
  name: string;
  coverage?: string;
  exposure?: string;
  value: string;
}

export interface RatingWarning {
  code: string;
  message: string;
  coverage?: string;
  exposure?: string;
}

export type TraceValue = string | number | boolean | null;

export interface WorksheetStep {
  coverage?: string;
  exposure?: string;
  name: string;
  operation: string;
  inputs: { ref: string; value: TraceValue }[];
  output: TraceValue;
}

export interface RaterArtifact {
  kind: "rating_plan" | "spreadsheet";
  key: string;
  version: string;
  hash?: string;
}

export interface RatingResult {
  currency: CurrencyCode;
  coverages: CoveragePremium[];
  adjustments: MinimumPremiumAdjustment[];
  factors: RatingFactor[];
  total: Money;
  warnings: RatingWarning[];
  worksheet: WorksheetStep[];
  artifact: RaterArtifact;
}

export interface Rater {
  readonly artifact: RaterArtifact;
  rate(input: RatingInput): Promise<RatingResult>;
}

export class RatingError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("invalid", message, details);
    this.name = "RatingError";
  }
}

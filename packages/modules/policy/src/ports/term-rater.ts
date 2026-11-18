import type { Jurisdiction, Money, PlainDate, TenantContext } from "@pas/kernel";
import type { FeeLine } from "../domain/proration";
import type { TransactionType } from "../domain/transaction";
import type { RatedCoverage } from "../domain/term-state";

export type CoverageAmount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

export interface CoverageChoice {
  coverage: string;
  exposure?: string;
  limit?: CoverageAmount;
  deductible?: CoverageAmount;
}

export interface CoverageOffer {
  code: string;
  name: string;
  description?: string;
  required: boolean;
  dependsOn: string[];
  attachesTo: { level: "policy" } | { level: "exposure"; path: string };
  limits: CoverageAmount[];
  deductibles: CoverageAmount[];
}

export interface TermRating {
  outcome: "quoted" | "referred" | "declined";
  reasons: { reasonCode: string; message: string; outcome: string; authority?: string }[];
  offers: CoverageOffer[];
  coverages: RatedCoverage[];
  taxesFees: FeeLine[];
  writtenPremium: Money;
  rater: unknown;
  decisions: { ref: string; result: unknown }[];
}

/**
 * Full-term rating with the term's pinned release (PLAN §7.4): the rater prices the term state as
 * of the change, rules re-run, and the PAS does the proration.
 */
export interface TermRater {
  rate(
    ctx: TenantContext,
    input: {
      productReleaseId: string;
      jurisdiction: Jurisdiction;
      termStart: PlainDate;
      termEnd: PlainDate;
      transaction: { type: TransactionType; effective: PlainDate };
      risk: Record<string, unknown>;
      coverages: CoverageChoice[];
    },
  ): Promise<TermRating>;
  /** The release's `taxes_fees` lines priced on a transaction's premium. */
  taxesOn(
    ctx: TenantContext,
    input: {
      productReleaseId: string;
      jurisdiction: Jurisdiction;
      risk: Record<string, unknown>;
      premium: Money;
    },
  ): Promise<FeeLine[]>;
}

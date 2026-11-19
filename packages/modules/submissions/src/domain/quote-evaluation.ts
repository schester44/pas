import type { DecisionKind } from "@pas/decisions-engine";
import type { Instant, Money } from "@pas/kernel";
import type { Attestation, DiligentSearch } from "./bind-requirements";
import type { CarrierQuoteState } from "./carrier-quote";
import type { CoverageOffer } from "./coverages";
import type { PayPlanOffer } from "./pay-plan-offers";
import type { TaxFeeLine } from "./taxes-fees";
import type { EvaluatedOutcome, UnderwritingReason } from "./underwriting";

export interface PremiumLine {
  coverage: string;
  exposure?: string;
  premium: Money;
}

export interface DecisionRecord {
  ref: string;
  kind: DecisionKind;
  name: string;
  result: unknown;
  trace?: unknown;
  durationMs: number;
}

/** Plain JSON from the rater: worksheet, factors, minimum-premium adjustments, warnings. */
export interface RatingRecord {
  artifact: { kind: string; key: string; version: string; hash?: string };
  worksheet: unknown[];
  factors: unknown[];
  adjustments: unknown[];
  warnings: { code: string; message: string }[];
  durationMs: number;
}

/** Everything one auto-evaluation produced, stored so the outcome can be explained and replayed. */
export interface QuoteEvaluation {
  outcome: EvaluatedOutcome;
  reasons: UnderwritingReason[];
  offers: CoverageOffer[];
  premium: PremiumLine[];
  writtenPremium: Money;
  taxesFees: TaxFeeLine[];
  total: Money;
  rating: RatingRecord | null;
  decisions: DecisionRecord[];
  diligentSearch: DiligentSearch | null;
  attestations: Attestation[];
  payPlans: PayPlanOffer[];
  /** An underwriter's loading or credit, already in the premium lines. */
  adjustment?: { percent: string; reason: string; amount: Money };
  /** Set when the release's carrier rates or confirms (PLAN §12). */
  carrier?: CarrierQuoteState;
  evaluatedAt: Instant;
  durationMs: number;
}

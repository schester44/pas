import type { Money } from "@pas/kernel";
import type { QuoteEvaluation } from "./quote-evaluation";
import type { EvaluatedOutcome } from "./underwriting";

export type SelectionStrategy = "all_eligible" | "cheapest" | "first_eligible";

/** A release the submission may be quoted on, pinned when it starts (PLAN §6.0). */
export interface Candidate {
  productId: string;
  productReleaseId: string;
  productVersionId: string;
  productVersion: string;
}

/** One candidate's auto-evaluation, kept for comparison; choosing it creates the Quote. */
export interface QuoteOption extends Candidate {
  outcome: EvaluatedOutcome;
  total: Money;
  reasons: { code: string; message: string }[];
  chosen: boolean;
}

export function optionFrom(candidate: Candidate, evaluation: QuoteEvaluation): QuoteOption {
  return {
    ...candidate,
    outcome: evaluation.outcome,
    total: evaluation.total,
    reasons: evaluation.reasons.map((r) => ({ code: r.reasonCode, message: r.message })),
    chosen: false,
  };
}

/**
 * The option the selection strategy settles on, in candidate order, or null when the agent should
 * compare and choose. Quoted beats referred; when everything declined, the first decline is shown
 * so its reasons reach the agent.
 */
export function pickOption(
  options: readonly QuoteOption[],
  strategy: SelectionStrategy,
): QuoteOption | null {
  const quoted = options.filter((o) => o.outcome === "quoted");
  const referred = options.filter((o) => o.outcome === "referred");

  if (strategy === "all_eligible" && quoted.length + referred.length > 1) return null;

  if (strategy === "cheapest" && quoted.length > 0) {
    return quoted.reduce((best, o) => (o.total.minus(best.total).isNegative() ? o : best));
  }

  return quoted[0] ?? referred[0] ?? options[0] ?? null;
}

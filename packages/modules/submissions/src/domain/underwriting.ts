import type { DecisionResult } from "@pas/decisions-engine";

export type ReasonSource = "eligibility" | "underwriting" | "referral_triggers" | "extension";

export interface UnderwritingReason {
  source: ReasonSource;
  decision: string;
  rule: string;
  outcome: "refer" | "decline" | "info_needed";
  reasonCode: string;
  message: string;
  internalMessage?: string;
  authority?: string;
}

export type EvaluatedOutcome = "quoted" | "referred" | "declined";

type Outcomes = DecisionResult<"underwriting">["outcomes"];

export function reasonsFrom(
  source: ReasonSource,
  decision: string,
  outcomes: Outcomes | DecisionResult<"eligibility">["outcomes"],
): UnderwritingReason[] {
  return outcomes.flatMap((row) =>
    row.outcome === "pass"
      ? []
      : [
          {
            source,
            decision,
            rule: row.rule,
            outcome: row.outcome,
            reasonCode: row.reasonCode,
            message: row.message,
            ...(row.internalMessage && { internalMessage: row.internalMessage }),
            ...(row.authority && { authority: row.authority }),
          },
        ],
  );
}

/**
 * Any decline declines (PLAN §7.2). Otherwise a refer or info request refers, unless an
 * underwriter already approved that reason code on this quote.
 */
export function outcomeOf(
  reasons: readonly UnderwritingReason[],
  approvedReasonCodes: readonly string[] = [],
): EvaluatedOutcome {
  if (reasons.some((reason) => reason.outcome === "decline")) return "declined";

  const approved = new Set(approvedReasonCodes);

  return reasons.some((reason) => !approved.has(reason.reasonCode)) ? "referred" : "quoted";
}

import { conflict } from "@pas/kernel";

export type CompletingParty = "insured" | "producer";

export interface CompletionRules {
  disclosures: CompletingParty;
  signature: CompletingParty;
  payment: CompletingParty | "either";
}

export type CompletionStep = keyof CompletionRules;

/** Where nothing is configured the producer completes everything, as releases did before. */
const PRODUCER_COMPLETES: CompletionRules = {
  disclosures: "producer",
  signature: "producer",
  payment: "producer",
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const party = (value: unknown, fallback: CompletingParty): CompletingParty =>
  value === "insured" || value === "producer" ? value : fallback;

/** Reads `lifecycle.completion`: who accepts the disclosures, signs and pays, each on its own. */
export function completionRules(lifecycle: Record<string, unknown>): CompletionRules {
  const completion = record(lifecycle.completion);

  return {
    disclosures: party(completion.disclosures, PRODUCER_COMPLETES.disclosures),
    signature: party(completion.signature, PRODUCER_COMPLETES.signature),
    payment:
      completion.payment === "either"
        ? "either"
        : party(completion.payment, PRODUCER_COMPLETES.payment as CompletingParty),
  };
}

export const completes = (rules: CompletionRules, step: CompletionStep, by: CompletingParty) =>
  rules[step] === by || rules[step] === "either";

export const insuredCompletesAny = (rules: CompletionRules) =>
  rules.disclosures === "insured" || rules.signature === "insured" || rules.payment !== "producer";

const STEP_LABEL: Record<CompletionStep, string> = {
  disclosures: "accepts the disclosures",
  signature: "signs the application",
  payment: "pays",
};

export function assertCompletes(
  rules: CompletionRules,
  step: CompletionStep,
  by: CompletingParty,
): void {
  if (completes(rules, step, by)) return;

  const who = rules[step] === "insured" ? "The insured" : "The producer";

  throw conflict(`${who} ${STEP_LABEL[step]} for this product`, {
    reason: "completed_by_other_party",
    step,
    completedBy: rules[step],
  });
}

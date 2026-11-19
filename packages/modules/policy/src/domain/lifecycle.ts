import type { RoundingMode } from "@pas/kernel";
import type { Rounding } from "./proration";

export interface CancellationReason {
  code: string;
  label: string;
  initiator: "insured" | "company";
}

/** The reasons catalog; a product narrows or relabels it in `lifecycle.transactions.cancellation`. */
export const CANCELLATION_REASONS: readonly CancellationReason[] = [
  { code: "insured_request", label: "Insured's request", initiator: "insured" },
  { code: "nonpayment", label: "Nonpayment of premium", initiator: "company" },
  { code: "underwriting", label: "Underwriting reasons", initiator: "company" },
  { code: "misrepresentation", label: "Material misrepresentation", initiator: "company" },
];

export interface LifecycleRules {
  reasons: CancellationReason[];
  reinstatementWindowDays: number;
  /** PLAN §7.4: an endorsement dated before issued ones rerolls them, or is rejected. */
  outOfSequence: "reroll" | "reject";
  rounding: Rounding;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const MODES: readonly RoundingMode[] = ["half_up", "half_even", "up", "down"];

/** Reads the release's lifecycle config; anything it leaves out falls back to the defaults. */
export function lifecycleRules(lifecycle: Record<string, unknown>): LifecycleRules {
  const transactions = record(lifecycle.transactions);
  const cancellation = record(transactions.cancellation);
  const reinstatement = record(transactions.reinstatement);
  const endorsement = record(transactions.endorsement);
  const rounding = record(lifecycle.rounding);

  const configured = Array.isArray(cancellation.reasons)
    ? (cancellation.reasons as Partial<CancellationReason>[]).filter(
        (r) => typeof r.code === "string",
      )
    : null;

  const reasons = configured
    ? configured.map((r) => {
        const known = CANCELLATION_REASONS.find((k) => k.code === r.code);

        return {
          code: r.code!,
          label: r.label ?? known?.label ?? r.code!,
          initiator: r.initiator ?? known?.initiator ?? "company",
        };
      })
    : [...CANCELLATION_REASONS];

  const windowDays = Number(reinstatement.windowDays);

  return {
    reasons,
    reinstatementWindowDays: Number.isInteger(windowDays) && windowDays >= 0 ? windowDays : 30,
    outOfSequence: endorsement.outOfSequence === "reroll" ? "reroll" : "reject",
    rounding: {
      places: Number.isInteger(rounding.places) ? (rounding.places as number) : 2,
      mode: MODES.includes(rounding.mode as RoundingMode)
        ? (rounding.mode as RoundingMode)
        : "half_up",
    },
  };
}

import type { DecisionResult } from "@pas/decisions-engine";
import { invalid, Money, type RoundingMode } from "@pas/kernel";

export type TaxFeeRule = DecisionResult<"taxes_fees">["lines"][number];

export interface TaxFeeLine {
  code: string;
  label: string;
  basis: TaxFeeRule["basis"];
  rate?: string;
  taxable: boolean;
  remitter: TaxFeeRule["remitter"];
  amount: Money;
}

export interface TaxFeeRounding {
  mode: RoundingMode;
  places: number;
}

/**
 * Prices `taxes_fees` decision lines on the written premium (PLAN §17.2.5). Flat and
 * premium-based lines come first because `premium_and_fees` lines are levied on the premium plus
 * every taxable line; each line rounds on its own, with the rule's rounding when it has one.
 */
export function computeTaxesAndFees(
  rules: readonly TaxFeeRule[],
  premium: Money,
  fallback: TaxFeeRounding,
): TaxFeeLine[] {
  const lines = new Map<number, TaxFeeLine>();

  const round = (rule: TaxFeeRule, amount: Money) =>
    amount.round(rule.places ?? fallback.places, rule.rounding ?? fallback.mode);

  for (const [index, rule] of rules.entries()) {
    if (rule.basis === "premium_and_fees") continue;

    const amount =
      rule.basis === "flat" ? flatAmount(rule, premium.currency) : premium.times(rateOf(rule));

    lines.set(index, toLine(rule, round(rule, amount)));
  }

  const taxableBase = [...lines.values()]
    .filter((line) => line.taxable)
    .reduce((sum, line) => sum.plus(line.amount), premium);

  for (const [index, rule] of rules.entries()) {
    if (rule.basis !== "premium_and_fees") continue;

    lines.set(index, toLine(rule, round(rule, taxableBase.times(rateOf(rule)))));
  }

  return rules.map((_, index) => lines.get(index)!);
}

export function totalOf(lines: readonly { amount: Money }[], currency: string): Money {
  return lines.reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));
}

function rateOf(rule: TaxFeeRule): string {
  if (rule.rate === undefined) {
    throw invalid(`${rule.label} needs a rate for its ${rule.basis} basis`, { code: rule.code });
  }

  return rule.rate;
}

function flatAmount(rule: TaxFeeRule, currency: string): Money {
  if (rule.amount === undefined) {
    throw invalid(`${rule.label} is flat, so it needs an amount`, { code: rule.code });
  }

  if (rule.currency !== currency) {
    throw invalid(`${rule.label} is in ${rule.currency}, but the premium is in ${currency}`, {
      code: rule.code,
    });
  }

  return Money.of(rule.amount, currency);
}

function toLine(rule: TaxFeeRule, amount: Money): TaxFeeLine {
  return {
    code: rule.code,
    label: rule.label,
    basis: rule.basis,
    ...(rule.rate !== undefined && { rate: rule.rate }),
    taxable: rule.taxable,
    remitter: rule.remitter,
    amount,
  };
}

/** Re-levies existing lines on a new premium, e.g. when the carrier's premium replaces ours. */
export function repriceTaxesAndFees(
  lines: readonly TaxFeeLine[],
  premium: Money,
  fallback: TaxFeeRounding,
): TaxFeeLine[] {
  const rules: TaxFeeRule[] = lines.map((line) => ({
    code: line.code,
    label: line.label,
    basis: line.basis,
    ...(line.rate !== undefined && { rate: line.rate }),
    ...(line.basis === "flat" && {
      amount: line.amount.toString(),
      currency: line.amount.currency,
    }),
    taxable: line.taxable,
    remitter: line.remitter,
  }));

  return computeTaxesAndFees(rules, premium, fallback);
}

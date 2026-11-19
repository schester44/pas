import { invalid, Money, type PlainDate, type RoundingMode } from "@pas/kernel";

export interface Rounding {
  places: number;
  mode: RoundingMode;
}

export type ProrationMethod = "pro_rata";

export interface ProrationPeriod {
  termStart: PlainDate;
  termEnd: PlainDate;
  from: PlainDate;
}

export interface PremiumLine {
  coverage: string;
  exposure?: string;
  name: string;
  premium: Money;
}

/** One coverage's full-term premium before and after, and the prorated amount the change bills. */
export interface PremiumChange {
  coverage: string;
  exposure?: string;
  name: string;
  before: Money;
  after: Money;
  amount: Money;
}

const compare = Temporal.PlainDate.compare;

export function daysOf(period: ProrationPeriod): { remaining: number; term: number } {
  const { termStart, termEnd, from } = period;

  if (compare(from, termStart) < 0 || compare(from, termEnd) > 0) {
    throw invalid(`${from.toString()} is outside the term`, {
      termStart: termStart.toString(),
      termEnd: termEnd.toString(),
    });
  }

  return {
    remaining: from.until(termEnd, { largestUnit: "days" }).days,
    term: termStart.until(termEnd, { largestUnit: "days" }).days,
  };
}

/** The share of a full-term amount for the days left from `from` to the end of the term. */
export function prorate(
  fullTerm: Money,
  period: ProrationPeriod,
  rounding: Rounding,
  method: ProrationMethod = "pro_rata",
): Money {
  if (method !== "pro_rata") throw invalid(`${method as string} proration isn't supported yet`);

  const { remaining, term } = daysOf(period);

  return fullTerm.times(remaining).dividedBy(term).round(rounding.places, rounding.mode);
}

const keyOf = (line: { coverage: string; exposure?: string }) =>
  `${line.coverage}@${line.exposure ?? ""}`;

/**
 * Full-term premium per coverage and exposure, before vs after, prorated from the change's
 * effective date (PLAN §7.4). Each line rounds on its own so the bill adds up line by line;
 * unchanged coverages produce no line.
 */
export function premiumDelta(
  before: readonly PremiumLine[],
  after: readonly PremiumLine[],
  period: ProrationPeriod,
  rounding: Rounding,
  method: ProrationMethod = "pro_rata",
): PremiumChange[] {
  const currency = (after[0] ?? before[0])?.premium.currency ?? "USD";
  const previous = new Map(before.map((line) => [keyOf(line), line]));
  const next = new Map(after.map((line) => [keyOf(line), line]));
  const keys = [...new Set([...next.keys(), ...previous.keys()])];

  return keys.flatMap((key) => {
    const was = previous.get(key);
    const now = next.get(key);
    const line = (now ?? was)!;
    const beforeAmount = was?.premium ?? Money.zero(currency);
    const afterAmount = now?.premium ?? Money.zero(currency);
    const change = afterAmount.minus(beforeAmount);

    if (change.isZero()) return [];

    return [
      {
        coverage: line.coverage,
        ...(line.exposure !== undefined && { exposure: line.exposure }),
        name: line.name,
        before: beforeAmount,
        after: afterAmount,
        amount: prorate(change, period, rounding, method),
      },
    ];
  });
}

export function sumOf(lines: readonly { amount: Money }[], currency: string): Money {
  return lines.reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));
}

/** Minimum earned premium, from the product's `cancellation_terms` decision. */
export interface MinimumEarned {
  type: "percent" | "flat";
  value: string;
  level: "policy" | "coverage";
  /** Reason or initiator codes it applies to; empty means every cancellation. */
  appliesTo: readonly string[];
}

export interface RetainedLine {
  coverage?: string;
  exposure?: string;
  name: string;
  minimum: Money;
  amount: Money;
}

export interface CancellationReturn {
  lines: PremiumChange[];
  minimumEarned: {
    rule: MinimumEarned;
    minimum: Money;
    retained: Money;
    lines: RetainedLine[];
  } | null;
}

export const minimumEarnedApplies = (
  rule: MinimumEarned | null | undefined,
  codes: readonly string[],
): rule is MinimumEarned =>
  !!rule && (rule.appliesTo.length === 0 || codes.some((code) => rule.appliesTo.includes(code)));

/**
 * Return premium for a cancellation: each coverage's unearned share, pro rata from the
 * cancellation date. When a minimum earned premium applies, earned = max(pro rata earned,
 * minimum) and the extra kept shows as its own negative-of-return line.
 */
export function cancellationReturn(
  current: readonly PremiumLine[],
  period: ProrationPeriod,
  rounding: Rounding,
  options: { minimumEarned?: MinimumEarned | null; codes?: readonly string[] } = {},
): CancellationReturn {
  const lines = premiumDelta(
    current,
    current.map((line) => ({ ...line, premium: line.premium.minus(line.premium) })),
    period,
    rounding,
  );

  const rule = options.minimumEarned;

  if (!minimumEarnedApplies(rule, options.codes ?? [])) return { lines, minimumEarned: null };

  const currency = (current[0]?.premium ?? Money.zero()).currency;

  const minimumOf = (fullTerm: Money) =>
    (rule.type === "percent"
      ? fullTerm.times(rule.value).dividedBy(100)
      : Money.of(rule.value, currency)
    ).round(rounding.places, rounding.mode);

  const retain = (
    fullTerm: Money,
    returned: Money,
    name: string,
    at?: { coverage: string; exposure?: string },
  ): RetainedLine[] => {
    const minimum = minimumOf(fullTerm);
    const earned = fullTerm.plus(returned);
    const short = minimum.minus(earned);
    const amount = short.amount.greaterThan(returned.negated().amount) ? returned.negated() : short;

    if (!amount.amount.greaterThan(0)) return [];

    return [{ ...at, name, minimum, amount }];
  };

  const retained =
    rule.level === "policy"
      ? retain(
          sumOf(
            current.map((l) => ({ amount: l.premium })),
            currency,
          ),
          sumOf(lines, currency),
          "Minimum earned premium",
        )
      : current.flatMap((line) => {
          const returned = lines.find(
            (l) => l.coverage === line.coverage && l.exposure === line.exposure,
          );

          return retain(
            line.premium,
            returned?.amount ?? Money.zero(currency),
            `Minimum earned premium · ${line.name}`,
            {
              coverage: line.coverage,
              ...(line.exposure !== undefined && { exposure: line.exposure }),
            },
          );
        });

  if (retained.length === 0) return { lines, minimumEarned: null };

  return {
    lines,
    minimumEarned: {
      rule,
      minimum: retained.reduce((sum, l) => sum.plus(l.minimum), Money.zero(currency)),
      retained: retained.reduce((sum, l) => sum.plus(l.amount), Money.zero(currency)),
      lines: retained,
    },
  };
}

export interface FeeLine {
  code: string;
  label: string;
  remitter: string;
  basis: "premium" | "premium_and_fees" | "flat";
  amount: Money;
}

/** Taxes and fees on a mid-term change: premium-based lines only; flat fees bill once. */
export const feesOnChange = (onPremium: readonly FeeLine[]) =>
  onPremium.filter((line) => line.basis !== "flat" && !line.amount.isZero());

/**
 * Taxes and fees returned on cancellation. Premium-based lines are levied on the return premium;
 * flat fees return pro rata from what was charged; fully earned fees never return.
 */
export function feesOnCancellation(
  onReturn: readonly FeeLine[],
  charged: readonly { code: string; amount: Money }[],
  period: ProrationPeriod,
  rounding: Rounding,
  fullyEarned: readonly string[],
): FeeLine[] {
  return onReturn.flatMap((line) => {
    if (fullyEarned.includes(line.code)) return [];

    if (line.basis !== "flat") return line.amount.isZero() ? [] : [line];

    const paid = charged.find((c) => c.code === line.code);

    if (!paid) return [];

    const amount = prorate(paid.amount.negated(), period, rounding);

    return amount.isZero() ? [] : [{ ...line, amount }];
  });
}

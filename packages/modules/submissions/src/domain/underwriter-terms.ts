import { Money, type RoundingMode, invalid } from "@pas/kernel";
import type { CoverageChoice, CoverageOffer } from "./coverages";
import type { PremiumLine } from "./quote-evaluation";

/** A premium loading (positive) or credit (negative) an underwriter applied, in percent. */
export interface PremiumAdjustment {
  percent: string;
  reason: string;
}

/** What an underwriter changed when approving a referral; it sticks through later requotes. */
export interface ReferralModifications {
  coverages: CoverageChoice[];
  adjustment: PremiumAdjustment | null;
}

export const NO_MODIFICATIONS: ReferralModifications = { coverages: [], adjustment: null };

const sameSlot = (a: CoverageChoice, b: CoverageChoice) =>
  a.coverage === b.coverage && a.exposure === b.exposure;

/** The producer's selection with the underwriter's coverage terms laid over it. */
export function withUnderwriterCoverages(
  selection: readonly CoverageChoice[],
  overrides: readonly CoverageChoice[],
): CoverageChoice[] {
  const merged = selection.map((choice) => {
    const override = overrides.find((o) => sameSlot(o, choice));

    return override ? { ...choice, ...override } : choice;
  });

  const added = overrides.filter((o) => !selection.some((choice) => sameSlot(choice, o)));

  return [...merged, ...added];
}

/** Total insured value: the money limits of the selected property (per-location) coverages. */
export function insuredValueOf(
  offers: readonly CoverageOffer[],
  selection: readonly CoverageChoice[],
  currency: string,
): Money {
  const perLocation = new Set(
    offers.filter((o) => o.attachesTo.level === "exposure").map((o) => o.code),
  );

  return selection.reduce(
    (sum, choice) =>
      perLocation.has(choice.coverage) && choice.limit?.kind === "money"
        ? sum.plus(Money.of(choice.limit.amount, currency))
        : sum,
    Money.zero(currency),
  );
}

/**
 * Applies a loading or credit to each coverage's premium. The total is rounded once and the last
 * line takes the rounding difference, so the lines always add up to the adjusted total.
 */
export function adjustPremium(
  lines: readonly PremiumLine[],
  percent: string,
  rounding: { mode: RoundingMode; places: number },
): { lines: PremiumLine[]; amount: Money } {
  if (!/^-?\d+(\.\d+)?$/.test(percent)) throw invalid(`${percent} isn't a percentage`);

  const [first] = lines;

  if (!first) return { lines: [], amount: Money.zero() };

  const currency = first.premium.currency;
  const factor = Money.of(percent, currency).dividedBy(100).plus(Money.of(1, currency)).toString();
  const before = lines.reduce((sum, line) => sum.plus(line.premium), Money.zero(currency));
  const target = before.times(factor).round(rounding.places, rounding.mode);

  const scaled = lines.map((line) => ({
    ...line,
    premium: line.premium.times(factor).round(rounding.places, rounding.mode),
  }));

  const drift = target.minus(scaled.reduce((sum, l) => sum.plus(l.premium), Money.zero(currency)));
  const last = scaled.at(-1)!;

  scaled[scaled.length - 1] = { ...last, premium: last.premium.plus(drift) };

  return { lines: scaled, amount: target.minus(before) };
}

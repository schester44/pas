import { Money, type PlainDate, type RoundingMode } from "@pas/kernel";
import type { InstallmentSplit, PayPlan } from "./model";

export interface Rounding {
  places: number;
  mode: RoundingMode;
}

export interface ScheduleCharge {
  code: string;
  label: string;
  amount: Money;
}

export interface ScheduleInput {
  premium: Money;
  taxesFees: readonly ScheduleCharge[];
  effectiveDate: PlainDate;
  billedOn: PlainDate;
  rounding: Rounding;
}

export interface Installment {
  number: number;
  installmentDate: PlainDate;
  issueOn: PlainDate;
  dueOn: PlainDate;
  premium: Money;
  taxesFees: ScheduleCharge[];
  fee: Money;
  total: Money;
}

const later = (a: PlainDate, b: PlainDate) => (Temporal.PlainDate.compare(a, b) >= 0 ? a : b);

/** The first installment's share of the premium; null means equal installments. */
function firstShare(plan: PayPlan): string | null {
  return plan.downPayment.kind === "percent" ? plan.downPayment.percent : null;
}

/**
 * Splits `total` into `count` rounded parts: the first is the down payment share (or an equal
 * part), the middle ones are equal, and the last takes the rounding remainder.
 */
export function splitAmount(
  total: Money,
  count: number,
  rounding: Rounding,
  firstPercent: string | null = null,
): Money[] {
  if (count <= 1) return [total];

  const first = (
    firstPercent === null ? total.dividedBy(count) : total.times(firstPercent).dividedBy(100)
  ).round(rounding.places, rounding.mode);

  const regular =
    firstPercent === null
      ? first
      : total
          .minus(first)
          .dividedBy(count - 1)
          .round(rounding.places, rounding.mode);

  const middle = Array.from({ length: count - 2 }, () => regular);
  const allocated = middle.reduce((sum, part) => sum.plus(part), first);

  return [first, ...middle, total.minus(allocated)];
}

/**
 * The installment schedule for a term under a plan (PLAN §13). The first installment is the down
 * payment, due on the billing date; each later one is due `dueDaysBefore` its installment date and
 * opens `billDaysBeforeDue` earlier. Amounts don't depend on dates.
 */
export function buildSchedule(plan: PayPlan, input: ScheduleInput): Installment[] {
  const custom = plan.split?.length ? plan.split : null;
  const count = custom ? custom.length : Math.max(1, plan.installments);
  const share = custom ? null : firstShare(plan);
  const currency = input.premium.currency;

  const premiums = custom
    ? custom.map((part) => Money.of(part.premium, currency))
    : splitAmount(input.premium, count, input.rounding, share);

  if (
    custom &&
    !premiums.reduce((sum, p) => sum.plus(p), Money.zero(currency)).equals(input.premium)
  ) {
    throw new Error("The custom installments don't add up to the premium");
  }

  const taxes = input.taxesFees.map((charge) =>
    plan.taxesFees === "spread" ? splitAmount(charge.amount, count, input.rounding, share) : null,
  );

  const fee = plan.installmentFee ? Money.of(plan.installmentFee, currency) : Money.zero(currency);

  return premiums.map((premium, index) => {
    const installmentDate = custom
      ? Temporal.PlainDate.from(custom[index]!.dueOn)
      : input.effectiveDate.add({ months: index * plan.intervalMonths });

    const taxesFees = input.taxesFees
      .map((charge, i) => ({
        ...charge,
        amount: taxes[i]?.[index] ?? (index === 0 ? charge.amount : Money.zero(currency)),
      }))
      .filter((charge) => !charge.amount.isZero());

    const installmentFee = index === 0 ? Money.zero(currency) : fee;

    const dueOn =
      index === 0
        ? input.billedOn
        : later(
            custom ? installmentDate : installmentDate.subtract({ days: plan.dueDaysBefore }),
            input.billedOn,
          );

    const issueOn =
      index === 0
        ? input.billedOn
        : later(dueOn.subtract({ days: plan.billDaysBeforeDue }), input.billedOn);

    return {
      number: index + 1,
      installmentDate,
      issueOn,
      dueOn,
      premium,
      taxesFees,
      fee: installmentFee,
      total: taxesFees.reduce((sum, c) => sum.plus(c.amount), premium.plus(installmentFee)),
    };
  });
}

/** Spreads an endorsement's additional premium over the remaining installments. */
export function spreadCharge(amount: Money, installments: number, rounding: Rounding): Money[] {
  return splitAmount(amount, installments, rounding);
}

const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const MAX_SPLIT = 24;

/**
 * Checks an extension's installment split before it's offered: amounts in cents that add up to
 * the premium exactly, at most 24 installments, due dates in order within the term.
 */
export function checkSplit(
  split: readonly InstallmentSplit[],
  input: { premium: Money; termStart: PlainDate; termEnd: PlainDate },
): string[] {
  const issues: string[] = [];

  if (split.length === 0) return ["Return at least one installment"];

  if (split.length > MAX_SPLIT) issues.push(`Return at most ${MAX_SPLIT} installments`);

  let previous: PlainDate | null = null;
  let total = Money.zero(input.premium.currency);

  split.forEach((part, i) => {
    if (!AMOUNT.test(part.premium)) {
      issues.push(`Installment ${i + 1}: ${part.premium} isn't an amount in cents`);

      return;
    }

    total = total.plus(Money.of(part.premium, input.premium.currency));

    let due: PlainDate;

    try {
      due = Temporal.PlainDate.from(part.dueOn);
    } catch {
      issues.push(`Installment ${i + 1}: ${part.dueOn} isn't a date`);

      return;
    }

    if (Temporal.PlainDate.compare(due, input.termEnd) > 0) {
      issues.push(`Installment ${i + 1} is due after the term ends`);
    }

    if (previous && Temporal.PlainDate.compare(due, previous) < 0) {
      issues.push(`Installment ${i + 1} is due before installment ${i}`);
    }

    previous = due;
  });

  if (issues.length === 0 && !total.equals(input.premium)) {
    issues.push(
      `The installments add up to ${total.toString()}, not the premium ${input.premium.toString()}`,
    );
  }

  return issues;
}

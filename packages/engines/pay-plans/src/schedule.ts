import { Money, type PlainDate, type RoundingMode } from "@pas/kernel";
import type { PayPlan } from "./model";

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
  const count = Math.max(1, plan.installments);
  const share = firstShare(plan);
  const premiums = splitAmount(input.premium, count, input.rounding, share);
  const currency = input.premium.currency;

  const taxes = input.taxesFees.map((charge) =>
    plan.taxesFees === "spread" ? splitAmount(charge.amount, count, input.rounding, share) : null,
  );

  const fee = plan.installmentFee ? Money.of(plan.installmentFee, currency) : Money.zero(currency);

  return premiums.map((premium, index) => {
    const installmentDate = input.effectiveDate.add({ months: index * plan.intervalMonths });

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
        : later(installmentDate.subtract({ days: plan.dueDaysBefore }), input.billedOn);

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

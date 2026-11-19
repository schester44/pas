import { Money, type PlainDate } from "@pas/kernel";

export type Business = "new" | "renewal";

/** A rate in percent. Null dimensions match anything; the most specific schedule wins. */
export interface CommissionSchedule {
  id: string;
  productId: string | null;
  country: string;
  subdivision: string | null;
  business: Business | null;
  tier: string | null;
  rate: string;
  effectiveDate: PlainDate;
  expirationDate: PlainDate | null;
}

export interface CommissionBasis {
  productId: string;
  country: string;
  subdivision: string | null;
  business: Business;
  tier: string;
  on: PlainDate;
}

const compare = Temporal.PlainDate.compare;

const matches = (value: string | null, wanted: string | null) => value === null || value === wanted;

const specificity = (s: CommissionSchedule) =>
  (s.productId ? 8 : 0) + (s.subdivision ? 4 : 0) + (s.business ? 2 : 0) + (s.tier ? 1 : 0);

export function scheduleFor(
  schedules: readonly CommissionSchedule[],
  basis: CommissionBasis,
): CommissionSchedule | null {
  const candidates = schedules.filter(
    (s) =>
      s.country === basis.country &&
      matches(s.productId, basis.productId) &&
      matches(s.subdivision, basis.subdivision) &&
      matches(s.business, basis.business) &&
      matches(s.tier, basis.tier) &&
      compare(s.effectiveDate, basis.on) <= 0 &&
      (!s.expirationDate || compare(basis.on, s.expirationDate) < 0),
  );

  return (
    candidates.toSorted(
      (a, b) => specificity(b) - specificity(a) || compare(b.effectiveDate, a.effectiveDate),
    )[0] ?? null
  );
}

export interface PremiumLine {
  financialTransactionId: string;
  kind: string;
  amount: Money;
}

export interface CommissionLine {
  financialTransactionId: string;
  scheduleId: string | null;
  premium: Money;
  rate: string;
  amount: Money;
}

/**
 * PLAN §13: commission on each premium financial transaction, at the schedule's rate, rounded
 * half-up to the cent per line. Return premium earns a negative commission (a chargeback).
 * Taxes and fees never carry commission.
 */
export function commissionsOn(
  lines: readonly PremiumLine[],
  schedule: Pick<CommissionSchedule, "id" | "rate"> | null,
): CommissionLine[] {
  const rate = schedule?.rate ?? "0";

  return lines
    .filter((line) => line.kind === "written_premium")
    .map((line) => ({
      financialTransactionId: line.financialTransactionId,
      scheduleId: schedule?.id ?? null,
      premium: line.amount,
      rate,
      amount: line.amount.times(rate).dividedBy(100).round(2, "half_up"),
    }));
}

export interface StatementEntry {
  premium: Money;
  amount: Money;
}

/** Agency statement totals: gross premium, commission and the net the agency owes. */
export function statementTotals(entries: readonly StatementEntry[], currency: string) {
  const gross = entries.reduce((sum, e) => sum.plus(e.premium), Money.zero(currency));
  const commission = entries.reduce((sum, e) => sum.plus(e.amount), Money.zero(currency));

  return { gross, commission, net: gross.minus(commission) };
}

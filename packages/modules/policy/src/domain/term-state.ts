import { Money } from "@pas/kernel";
import { stableExposure } from "./exposures";
import type { PremiumLine } from "./proration";

type MoneyJson = { amount: string; currency: string };

export interface RatedCoverage extends PremiumLine {
  limit?: unknown;
  deductible?: unknown;
}

const isMoney = (value: unknown): value is MoneyJson =>
  typeof value === "object" && value !== null && "amount" in value && "currency" in value;

/**
 * Full-term premium by coverage, as the TermVersion snapshot recorded it, with exposures keyed by
 * row id even where the snapshot keyed them by position.
 */
export function coveragesOf(snapshot: Record<string, unknown>): RatedCoverage[] {
  const rows = (snapshot.coverages ?? []) as Record<string, unknown>[];

  return rows.map((row) => ({
    coverage: String(row.coverage),
    ...(typeof row.exposure === "string" && {
      exposure: stableExposure(snapshot.risk, row.exposure)!,
    }),
    name: String(row.name ?? row.coverage),
    ...(row.limit !== undefined && { limit: row.limit }),
    ...(row.deductible !== undefined && { deductible: row.deductible }),
    premium: isMoney(row.premium)
      ? Money.of(row.premium.amount, row.premium.currency)
      : Money.zero(),
  }));
}

export function feesOf(snapshot: Record<string, unknown>) {
  const rows = (snapshot.taxesFees ?? []) as Record<string, unknown>[];

  return rows.flatMap((row) =>
    isMoney(row.amount)
      ? [
          {
            code: String(row.code),
            label: String(row.label),
            amount: Money.of(row.amount.amount, row.amount.currency),
          },
        ]
      : [],
  );
}

export function annualOf(snapshot: Record<string, unknown>, currency: string): Money {
  return coveragesOf(snapshot).reduce((sum, c) => sum.plus(c.premium), Money.zero(currency));
}

export const coverageJson = (c: RatedCoverage) => ({
  coverage: c.coverage,
  name: c.name,
  ...(c.exposure !== undefined && { exposure: c.exposure }),
  ...(c.limit !== undefined && { limit: c.limit }),
  ...(c.deductible !== undefined && { deductible: c.deductible }),
  premium: c.premium.toJSON(),
});

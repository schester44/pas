import { Money, type PlainDate } from "@pas/kernel";
import { type AccountType, isDebitNormal, type PayerType } from "./accounts";

export interface AccountBalance {
  code: string;
  name: string;
  type: AccountType;
  balance: Money;
}

export interface TrialBalance {
  rows: { code: string; name: string; type: AccountType; debit: Money; credit: Money }[];
  debits: Money;
  credits: Money;
  balanced: boolean;
}

/** Each account's signed balance in its debit or credit column; balanced when the columns agree. */
export function trialBalance(balances: readonly AccountBalance[], currency: string): TrialBalance {
  const zero = Money.zero(currency);

  const rows = balances
    .filter((b) => b.balance.currency === currency)
    .toSorted((a, b) => a.code.localeCompare(b.code))
    .map((b) => ({
      code: b.code,
      name: b.name,
      type: b.type,
      debit: b.balance.isNegative() ? zero : b.balance,
      credit: b.balance.isNegative() ? b.balance.negated() : zero,
    }));

  const debits = rows.reduce((sum, r) => sum.plus(r.debit), zero);
  const credits = rows.reduce((sum, r) => sum.plus(r.credit), zero);

  return { rows, debits, credits, balanced: debits.equals(credits) };
}

/** A balance as people read it: positive when it sits on the account's normal side. */
export const naturalBalance = (type: AccountType, signed: Money) =>
  isDebitNormal(type) ? signed : signed.negated();

export const AGING_BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function bucketOf(dueOn: PlainDate, asOf: PlainDate): AgingBucket {
  const late = dueOn.until(asOf, { largestUnit: "days" }).days;

  if (late <= 0) return "current";

  if (late <= 30) return "1_30";

  if (late <= 60) return "31_60";

  if (late <= 90) return "61_90";

  return "over_90";
}

export interface AgingItem {
  payerType: PayerType;
  dueOn: PlainDate;
  balance: Money;
}

export interface AgingRow {
  payerType: PayerType;
  buckets: Record<AgingBucket, Money>;
  credits: Money;
  total: Money;
}

/** Open receivables by payer type and days past due; credit balances are kept apart. */
export function ageReceivables(
  items: readonly AgingItem[],
  asOf: PlainDate,
  currency: string,
): AgingRow[] {
  const zero = Money.zero(currency);
  const rows = new Map<PayerType, AgingRow>();

  const rowFor = (payerType: PayerType) => {
    const existing = rows.get(payerType);

    if (existing) return existing;

    const row: AgingRow = {
      payerType,
      buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, zero])) as Record<
        AgingBucket,
        Money
      >,
      credits: zero,
      total: zero,
    };

    rows.set(payerType, row);

    return row;
  };

  for (const item of items) {
    if (item.balance.isZero() || item.balance.currency !== currency) continue;

    const row = rowFor(item.payerType);

    if (item.balance.isNegative()) row.credits = row.credits.plus(item.balance);
    else {
      const bucket = bucketOf(item.dueOn, asOf);
      row.buckets[bucket] = row.buckets[bucket].plus(item.balance);
    }

    row.total = row.total.plus(item.balance);
  }

  return [...rows.values()];
}

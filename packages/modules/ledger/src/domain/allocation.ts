import { conflict, invalid, type Money, type PlainDate } from "@pas/kernel";

export interface OpenItem {
  invoiceId: string;
  dueOn: PlainDate;
  balance: Money;
}

export interface Allocation {
  invoiceId: string;
  amount: Money;
}

const minOf = (a: Money, b: Money) => (a.amount.lessThan(b.amount) ? a : b);

/** Oldest due first; anything left over stays unapplied (an overpayment). */
export function allocateOldestFirst(
  amount: Money,
  items: readonly OpenItem[],
): { allocations: Allocation[]; remainder: Money } {
  const open = items
    .filter((item) => item.balance.amount.greaterThan(0))
    .toSorted((a, b) => Temporal.PlainDate.compare(a.dueOn, b.dueOn));

  const allocations: Allocation[] = [];
  let remainder = amount;

  for (const item of open) {
    if (!remainder.amount.greaterThan(0)) break;

    const share = minOf(remainder, item.balance);
    allocations.push({ invoiceId: item.invoiceId, amount: share });
    remainder = remainder.minus(share);
  }

  return { allocations, remainder };
}

/** Staff chose the split: each share fits its invoice, and together they fit the payment. */
export function checkAllocations(
  unapplied: Money,
  requested: readonly Allocation[],
  balances: ReadonlyMap<string, Money>,
): void {
  if (requested.length === 0) throw invalid("Choose at least one invoice");

  const seen = new Set<string>();
  let total = unapplied.minus(unapplied);

  for (const allocation of requested) {
    if (seen.has(allocation.invoiceId)) throw invalid("Each invoice can be chosen once");

    seen.add(allocation.invoiceId);

    if (!allocation.amount.amount.greaterThan(0)) throw invalid("Applied amounts must be positive");

    const balance = balances.get(allocation.invoiceId);

    if (!balance) throw conflict(`Invoice ${allocation.invoiceId} isn't open`);

    if (allocation.amount.amount.greaterThan(balance.amount)) {
      throw conflict(`${allocation.amount.toString()} is more than the ${balance.toString()} open`);
    }

    total = total.plus(allocation.amount);
  }

  if (total.amount.greaterThan(unapplied.amount)) {
    throw conflict(
      `That applies ${total.toString()}, more than the ${unapplied.toString()} unapplied`,
    );
  }
}

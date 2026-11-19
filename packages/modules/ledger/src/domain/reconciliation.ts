import { Money } from "@pas/kernel";

export interface PasBalance {
  invoiceId: string;
  number: string;
  balance: Money;
}

export interface Difference {
  invoiceId: string;
  number: string;
  ledger: Money;
  pas: Money;
  difference: Money;
}

export interface Reconciliation {
  invoices: number;
  ledgerTotal: Money;
  pasTotal: Money;
  differences: Difference[];
}

/**
 * Ledger receivables per invoice against PAS's open balances. Any invoice where they disagree,
 * or that only one side knows, is a difference.
 */
export function reconcileReceivables(
  ledger: ReadonlyMap<string, { number: string; balance: Money }>,
  pas: readonly PasBalance[],
  currency: string,
): Reconciliation {
  const zero = Money.zero(currency);
  const pasById = new Map(pas.map((p) => [p.invoiceId, p]));
  const ids = new Set([...ledger.keys(), ...pasById.keys()]);
  const differences: Difference[] = [];
  let ledgerTotal = zero;
  let pasTotal = zero;

  for (const invoiceId of ids) {
    const l = ledger.get(invoiceId);
    const p = pasById.get(invoiceId);
    const ledgerBalance = l?.balance ?? zero;
    const pasBalance = p?.balance ?? zero;

    ledgerTotal = ledgerTotal.plus(ledgerBalance);
    pasTotal = pasTotal.plus(pasBalance);

    if (ledgerBalance.equals(pasBalance)) continue;

    differences.push({
      invoiceId,
      number: p?.number ?? l?.number ?? invoiceId,
      ledger: ledgerBalance,
      pas: pasBalance,
      difference: ledgerBalance.minus(pasBalance),
    });
  }

  return {
    invoices: ids.size,
    ledgerTotal,
    pasTotal,
    differences: differences.toSorted((a, b) => a.number.localeCompare(b.number)),
  };
}

export interface CachedBalance {
  account: string;
  currency: string;
  cached: Money;
  derived: Money;
}

/** Cached account balances that no longer equal the sum of their lines. */
export const cacheDrift = (balances: readonly CachedBalance[]) =>
  balances.filter((b) => !b.cached.equals(b.derived));

import { invalid, Money, type RoundingMode } from "@pas/kernel";

export type ChargeKind = "written_premium" | "tax_fee";

export interface Charge {
  kind: ChargeKind;
  code: string;
  label: string;
  coverage?: string;
  exposure?: string;
  amount: Money;
}

export interface InvoiceDraft {
  kind: "invoice" | "credit_note";
  lines: Charge[];
  total: Money;
}

const ORDER: Record<ChargeKind, number> = { written_premium: 0, tax_fee: 1 };

/**
 * Invoice lines from a transaction's financial transactions: premium by coverage first, then
 * taxes and fees. Each line is rounded on its own and the total is the sum of the printed lines,
 * so the bill always adds up. A negative total is a credit note (return premium).
 */
export function invoiceFrom(
  charges: readonly Charge[],
  currency: string,
  rounding: { places: number; mode: RoundingMode },
): InvoiceDraft {
  if (charges.length === 0) throw invalid("An invoice needs at least one line");

  const lines = charges
    .map((charge, position) => ({ charge, position }))
    .toSorted((a, b) => ORDER[a.charge.kind] - ORDER[b.charge.kind] || a.position - b.position)
    .map(({ charge }) => {
      if (charge.amount.currency !== currency) {
        throw invalid(`${charge.label} is in ${charge.amount.currency}, not ${currency}`);
      }

      return { ...charge, amount: charge.amount.round(rounding.places, rounding.mode) };
    });

  const total = lines.reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));

  return { kind: total.isNegative() ? "credit_note" : "invoice", lines, total };
}

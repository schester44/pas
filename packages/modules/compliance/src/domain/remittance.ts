import { Money } from "@pas/kernel";
import type { ObligationProps } from "./obligation";

export interface RemittanceLine {
  obligationId: string;
  policyNumber: string;
  insuredName: string;
  transactionType: string;
  effectiveDate: string;
  issuedDate: string;
  filingNumber: string | null;
  premium: Money;
  taxes: { code: string; label: string; amount: Money }[];
}

export interface RemittanceReport {
  lines: RemittanceLine[];
  premium: Money;
  taxes: { code: string; label: string; amount: Money }[];
  total: Money;
}

interface FilingData {
  insuredName?: string;
  effectiveDate?: string;
  issuedDate?: string;
  premium?: { amount: string; currency: string };
  taxesFees?: {
    code: string;
    label: string;
    remitter: string | null;
    amount: { amount: string; currency: string };
  }[];
}

/** The licensee's remittance for a period: every filed transaction and the taxes it owes (PLAN §17.2.8). */
export function remittanceReport(
  filings: readonly Readonly<ObligationProps>[],
  currency: string,
): RemittanceReport {
  const lines = filings.map((o): RemittanceLine => {
    const data = o.data as FilingData;

    return {
      obligationId: o.id,
      policyNumber: o.subject.policyNumber ?? "",
      insuredName: data.insuredName ?? "",
      transactionType: o.subject.transactionType ?? "",
      effectiveDate: data.effectiveDate ?? "",
      issuedDate: data.issuedDate ?? "",
      filingNumber:
        o.proof?.filingNumber ?? o.filings.findLast((f) => f.filingNumber)?.filingNumber ?? null,
      premium: Money.of(data.premium?.amount ?? 0, data.premium?.currency ?? currency),
      taxes: (data.taxesFees ?? [])
        .filter((t) => t.remitter === "licensee")
        .map((t) => ({
          code: t.code,
          label: t.label,
          amount: Money.of(t.amount.amount, t.amount.currency),
        })),
    };
  });

  const byCode = new Map<string, { code: string; label: string; amount: Money }>();

  for (const tax of lines.flatMap((l) => l.taxes)) {
    const seen = byCode.get(tax.code);

    byCode.set(tax.code, seen ? { ...seen, amount: seen.amount.plus(tax.amount) } : { ...tax });
  }

  const premium = lines.reduce((sum, l) => sum.plus(l.premium), Money.zero(currency));
  const taxes = [...byCode.values()];
  const total = taxes.reduce((sum, t) => sum.plus(t.amount), Money.zero(currency));

  return { lines, premium, taxes, total };
}

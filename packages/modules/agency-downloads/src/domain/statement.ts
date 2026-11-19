import type { MoneyValue } from "./record";

/** A direct-bill commission statement for one agency and period, as the formats serialize it. */
export interface CommissionStatementRecord {
  version: 1;
  agency: { id: string; name: string; code: string | null; accountCode: string };
  period: { from: string; to: string };
  entries: {
    policyNumber: string;
    insuredName: string;
    transactionType: string;
    effectiveDate: string;
    premium: MoneyValue;
    rate: string;
    commission: MoneyValue;
  }[];
  totals: { gross: MoneyValue; commission: MoneyValue; net: MoneyValue };
}

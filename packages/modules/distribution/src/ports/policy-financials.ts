import type { Money, PlainDate, TenantContext } from "@pas/kernel";

/** One issued policy transaction and its money, as Policy reports it for commissions. */
export interface TransactionFinancials {
  policyId: string;
  policyNumber: string;
  insuredName: string;
  productId: string;
  country: string;
  subdivision: string | null;
  termNumber: number;
  transactionId: string;
  transactionType: string;
  effectiveDate: PlainDate;
  producerId: string;
  agencyId: string | null;
  lines: { financialTransactionId: string; kind: string; amount: Money }[];
}

export interface PolicyFinancials {
  transaction(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<TransactionFinancials | null>;
}

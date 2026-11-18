import type { TenantContext, Transaction } from "@pas/kernel";

type MoneyJson = { amount: string; currency: string };

export interface IssuedInvoice {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  total: MoneyJson;
}

/** Billing, called inside the issuing transaction: no financial transaction goes unbilled. */
export interface InvoiceIssuer {
  issue(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      policyNumber: string;
      transactionId: string;
      currency: string;
      charges: {
        kind: "written_premium" | "tax_fee";
        code: string;
        label: string;
        coverage?: string;
        exposure?: string;
        amount: MoneyJson;
      }[];
      issuedOn: string;
      dueOn: string;
    },
  ): Promise<IssuedInvoice>;
}

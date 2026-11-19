import type { TenantContext, Transaction } from "@pas/kernel";
import type { Dunning, PayPlan } from "@pas/pay-plans";
import type { BillingMethod } from "../domain/policy";

type MoneyJson = { amount: string; currency: string };

export interface IssuedInvoice {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  total: MoneyJson;
  spread?: { installments: number; numbers: string[] };
  netted?: { credited: MoneyJson; installments: number };
}

/** Billing, called inside the issuing transaction: no financial transaction goes unbilled. */
export interface InvoiceIssuer {
  issue(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      policyNumber: string;
      termId: string;
      transactionId: string;
      transactionType: string;
      effectiveDate: string;
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
      schedule?: { plan: PayPlan; dunning: Dunning; billingMethod: BillingMethod };
    },
  ): Promise<IssuedInvoice>;
}

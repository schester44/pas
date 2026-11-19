import type { TenantContext } from "@pas/kernel";

type MoneyJson = { amount: string; currency: string };

export interface StatementDocument {
  number: string;
  agency: { name: string; address: unknown };
  periodStart: string;
  periodEnd: string;
  issuedOn: string;
  dueOn: string;
  remittanceBasis: "gross" | "net";
  items: {
    policyNumber: string;
    insuredName: string;
    transaction: string;
    effectiveDate: string;
    gross: MoneyJson;
    commission: MoneyJson;
    net: MoneyJson;
    due: MoneyJson;
  }[];
  totals: { gross: MoneyJson; commission: MoneyJson; net: MoneyJson; due: MoneyJson };
}

export interface MortgageePacketDocument {
  title: string;
  lender: { name: string; loanNumber: string | null; address: unknown };
  invoice: { number: string; issuedOn: string; dueOn: string; total: MoneyJson };
  policyId: string;
  reminder: boolean;
}

/** Renders billing's documents through the documents engine. */
export interface BillingDocuments {
  statement(ctx: TenantContext, input: StatementDocument): Promise<Uint8Array>;
  /** Invoice, evidence of insurance and declarations for the lender (PLAN §13). */
  mortgageePacket(ctx: TenantContext, input: MortgageePacketDocument): Promise<Uint8Array>;
}

import type { TenantContext } from "@pas/kernel";

type MoneyJson = { amount: string; currency: string };

/** Agency-bill terms as distribution keeps them (PLAN §13). */
export interface AgencyTerms {
  agencyId: string;
  name: string;
  address: unknown;
  mayAgencyBill: boolean;
  eligible: boolean;
  suspension: { at: string; reason: string } | null;
  remittanceDays: number;
  creditLimit: MoneyJson | null;
  remittanceBasis: "gross" | "net";
  statementDay: number | null;
  reminderDays: number | null;
  suspendAfterDays: number | null;
  nonpaymentCancels: boolean;
  contacts: string[];
}

export interface AgencyDirectory {
  terms(ctx: TenantContext, input: { agencyId: string }): Promise<AgencyTerms>;
  /** Commission recorded per policy transaction. */
  commissions(
    ctx: TenantContext,
    input: { transactionIds: readonly string[] },
  ): Promise<Record<string, MoneyJson>>;
}

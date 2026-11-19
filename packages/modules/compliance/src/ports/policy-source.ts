import type { JdmDecision } from "@pas/decisions-engine";
import type { TenantContext, Transaction } from "@pas/kernel";

export interface TransactionFacts {
  policyId: string;
  policyNumber: string;
  productId: string;
  insuredName: string;
  termId: string;
  productReleaseId: string;
  jurisdiction: { country: string; subdivision?: string };
  termEffectiveDate: string;
  termExpirationDate: string;
  transaction: {
    id: string;
    type: string;
    effectiveDate: string;
    issuedAt: string;
    premium: { amount: string; currency: string };
  };
  taxesFees: {
    code: string;
    label: string;
    remitter: string | null;
    amount: { amount: string; currency: string };
  }[];
  bound: Record<string, unknown>;
  risk: Record<string, unknown>;
}

export interface ComplianceRelease {
  id: string;
  market: "admitted" | "non_admitted";
  rules: { kind: string; key: string; decision: JdmDecision }[];
}

/** Policy administration and the catalog, seen from compliance. */
export interface PolicySource {
  transaction(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<TransactionFacts>;
  release(ctx: TenantContext, id: string): Promise<ComplianceRelease>;
}

export type ComplianceTimelineEvent =
  | "obligations_created"
  | "filing_submitted"
  | "filing_accepted"
  | "filing_rejected"
  | "obligation_overdue";

/** Writes to the policy's timeline in the caller's transaction (PLAN §7.4.1). */
export interface PolicyTimeline {
  record(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      type: ComplianceTimelineEvent;
      summary: string;
      data: Record<string, unknown>;
      transactionId?: string;
    },
  ): Promise<void>;
}

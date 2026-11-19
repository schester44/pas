import type { TenantContext } from "@pas/kernel";
import type { Dunning, MortgageeFollowUp, PayPlan } from "@pas/pay-plans";
import type { InsuredParty } from "../domain/insured";

export interface MoneyJson {
  amount: string;
  currency: string;
}

export interface NewBusinessRequest {
  quoteId: string;
  /** The carrier's number when it owns policy numbering (PLAN §12); otherwise ours. */
  policyNumber?: string;
  submissionId: string;
  productId: string;
  productName: string;
  productReleaseId: string;
  productVersion: string;
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
  expirationDate: string;
  insuredName: string;
  insureds: InsuredParty[];
  producer: { id: string; name: string; agencyId: string | null };
  currency: string;
  coverages: {
    coverage: string;
    name: string;
    exposure?: string;
    limit?: unknown;
    deductible?: unknown;
    premium: MoneyJson;
  }[];
  taxesFees: { code: string; label: string; remitter: string; amount: MoneyJson }[];
  writtenPremium: MoneyJson;
  snapshot: Record<string, unknown>;
  billing: {
    method: "direct" | "agency" | "mortgagee";
    payPlan: PayPlan | null;
    dunning: Dunning;
    payer?: {
      payer: "insured" | "agency" | "mortgagee";
      payerRef: string | null;
      payerName: string | null;
      payerAddress: {
        line1: string;
        line2?: string;
        city: string;
        region: string;
        postalCode: string;
        country?: string;
      } | null;
    };
    mortgagee?: { followUp: MortgageeFollowUp; lenderEmail: string | null };
  };
  actor: TimelineActor;
  history: {
    type: string;
    occurredAt: string;
    actor: TimelineActor;
    summary: string;
    data: Record<string, unknown>;
  }[];
}

export interface TimelineActor {
  type: "user" | "system" | "api";
  id?: string;
  name: string;
}

export interface IssuedPolicy {
  policyId: string;
  policyNumber: string;
  termId: string;
  transactionId: string;
  invoice: { id: string; number: string; total: MoneyJson };
}

/** Policy administration, seen from the bind step. `issue` is idempotent on `quoteId`. */
export interface PolicyIssuer {
  issue(ctx: TenantContext, request: NewBusinessRequest): Promise<IssuedPolicy>;
  attachDocuments(
    ctx: TenantContext,
    input: {
      policyId: string;
      transactionId: string;
      documents: { kind: string; title: string; storageKey: string; sizeBytes: number }[];
      actor: TimelineActor;
    },
  ): Promise<void>;
  /** Applies the captured payment to the transaction's invoice; idempotent on the reference. */
  applyPayment(
    ctx: TenantContext,
    input: {
      invoiceId: string;
      amount: MoneyJson;
      provider: string;
      providerRef: string;
      method: Record<string, unknown>;
      methodLabel: string;
      actor: TimelineActor;
    },
  ): Promise<void>;
  /** Saves the consented card for autopay on the policy's installments. */
  enrollAutopay(
    ctx: TenantContext,
    input: {
      policyId: string;
      provider: string;
      methodRef: string;
      customerRef: string | null;
      method: { brand: string; last4: string; expMonth: number; expYear: number };
      consent: { acceptedAt: string; by: string };
      actor: TimelineActor;
    },
  ): Promise<void>;
}

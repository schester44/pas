import type { Instant, Jurisdiction, Money, TenantContext } from "@pas/kernel";
import type { InspectionType, SubjectivityOwner, SubjectivityTiming } from "@pas/decisions-engine";
import type { InspectionAddress } from "../domain/inspection";
import type { Producer, ReferralReason } from "../domain/referral";

export interface CoverageTerms {
  coverage: string;
  exposure?: string;
  limit?: { kind: "money"; amount: string; currency: string } | { kind: "percent"; value: string };
  deductible?:
    | { kind: "money"; amount: string; currency: string }
    | { kind: "percent"; value: string };
}

export interface UnderwriterTerms {
  coverages: CoverageTerms[];
  adjustment: { percent: string; reason: string } | null;
}

export interface DecidedSubjectivity {
  code: string;
  title: string;
  description?: string;
  timing: SubjectivityTiming;
  dueDays?: number;
  owner?: SubjectivityOwner;
  consequence?: string;
}

export interface RequiredInspection {
  code: string;
  type: InspectionType;
  timing: SubjectivityTiming;
  reason: string;
}

/** What underwriting needs to know about a quote, read from the submissions context. */
export interface QuoteFacts {
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  status: string;
  revision: number;
  productId: string;
  productName: string;
  jurisdiction: Jurisdiction;
  insuredName: string | null;
  producer: Producer;
  reasons: ReferralReason[];
  writtenPremium: Money;
  total: Money;
  insuredValue: Money;
  reviewBy: Instant | null;
  policy: { id: string; number: string } | null;
  boundAt: Instant | null;
  subjectivities: DecidedSubjectivity[];
  inspections: RequiredInspection[];
  location: InspectionAddress | null;
}

/** The submissions context's quote actions, as underwriting uses them (PLAN §11). */
export interface QuoteDesk {
  facts(ctx: TenantContext, input: { submissionId: string }): Promise<QuoteFacts>;
  preview(
    ctx: TenantContext,
    input: { submissionId: string; terms: UnderwriterTerms },
  ): Promise<{ writtenPremium: Money; total: Money; insuredValue: Money }>;
  approve(
    ctx: TenantContext,
    input: {
      submissionId: string;
      underwriterName: string;
      note?: string;
      conditions: string[];
      terms: UnderwriterTerms;
    },
  ): Promise<void>;
  decline(
    ctx: TenantContext,
    input: {
      submissionId: string;
      underwriterName: string;
      note?: string;
      reasons: { code: string; message: string }[];
      adverseActionNotice?: string;
    },
  ): Promise<void>;
}

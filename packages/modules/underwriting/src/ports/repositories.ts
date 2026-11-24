import type { TenantContext, Transaction } from "@pas/kernel";
import type { Inspection, InspectionId } from "../domain/inspection";
import type { Referral, ReferralId, ReferralStatus } from "../domain/referral";
import type { UnderwritingSettings } from "../domain/settings";
import type { Subjectivity, SubjectivityId } from "../domain/subjectivity";

export interface ReferralFilter {
  statuses?: readonly ReferralStatus[];
  productId?: string;
  jurisdiction?: string;
  assigneeId?: string | null;
  openedBefore?: Temporal.Instant;
  submissionIds?: readonly string[];
  limit?: number;
}

export interface ReferralRepository {
  save(tx: Transaction, referral: Referral): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: ReferralId): Promise<Referral | null>;
  /** The quote's undecided referral, if any. */
  findOpenByQuote(tx: Transaction, ctx: TenantContext, quoteId: string): Promise<Referral | null>;
  listByQuote(tx: Transaction, ctx: TenantContext, quoteId: string): Promise<Referral[]>;
  list(tx: Transaction, ctx: TenantContext, filter: ReferralFilter): Promise<Referral[]>;
}

export interface SubjectivityRepository {
  save(tx: Transaction, subjectivity: Subjectivity): Promise<void>;
  remove(tx: Transaction, ctx: TenantContext, id: SubjectivityId): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: SubjectivityId): Promise<Subjectivity | null>;
  listByQuote(tx: Transaction, ctx: TenantContext, quoteId: string): Promise<Subjectivity[]>;
  listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string): Promise<Subjectivity[]>;
  listOpen(tx: Transaction, ctx: TenantContext, limit: number): Promise<Subjectivity[]>;
  listOpenBySubmissions(
    tx: Transaction,
    ctx: TenantContext,
    submissionIds: readonly string[],
  ): Promise<Subjectivity[]>;
}

export interface InspectionRepository {
  save(tx: Transaction, inspection: Inspection): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: InspectionId): Promise<Inspection | null>;
  listByQuote(tx: Transaction, ctx: TenantContext, quoteId: string): Promise<Inspection[]>;
  listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string): Promise<Inspection[]>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { statuses?: readonly string[]; limit?: number },
  ): Promise<Inspection[]>;
}

export interface SettingsRepository {
  get(tx: Transaction, ctx: TenantContext): Promise<UnderwritingSettings>;
  save(tx: Transaction, ctx: TenantContext, settings: UnderwritingSettings): Promise<void>;
}

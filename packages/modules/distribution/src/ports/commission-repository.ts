import type { Instant, Money, PlainDate, TenantContext, Transaction } from "@pas/kernel";
import type { Business, CommissionSchedule } from "../domain/commission";
import type { LicensingMode } from "../domain/license";

export interface CommissionRecord {
  id: string;
  financialTransactionId: string;
  transactionId: string;
  transactionType: string;
  policyId: string;
  policyNumber: string;
  insuredName: string;
  agencyId: string | null;
  producerId: string;
  scheduleId: string | null;
  business: Business;
  premium: Money;
  rate: string;
  amount: Money;
  effectiveDate: PlainDate;
  recordedAt: Instant;
}

export interface LicensingRequirement {
  productId: string;
  mode: LicensingMode;
  linesOfAuthority: string[];
}

export interface CommissionRepository {
  schedules(tx: Transaction, ctx: TenantContext): Promise<CommissionSchedule[]>;
  saveSchedule(
    tx: Transaction,
    ctx: TenantContext,
    schedule: CommissionSchedule,
    at: Instant,
  ): Promise<void>;
  deleteSchedule(tx: Transaction, ctx: TenantContext, id: string): Promise<void>;
  /** Inserts rows not yet recorded for their financial transaction; returns how many were new. */
  record(tx: Transaction, ctx: TenantContext, rows: readonly CommissionRecord[]): Promise<number>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyIds?: readonly string[]; policyId?: string; from?: Instant; to?: Instant },
  ): Promise<CommissionRecord[]>;
  requirements(tx: Transaction, ctx: TenantContext): Promise<LicensingRequirement[]>;
  saveRequirement(
    tx: Transaction,
    ctx: TenantContext,
    requirement: LicensingRequirement,
    at: Instant,
  ): Promise<void>;
}

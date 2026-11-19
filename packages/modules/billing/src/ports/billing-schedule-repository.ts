import type { TenantContext, Transaction } from "@pas/kernel";
import type { BillingSchedule, SavedPaymentMethod } from "../domain/billing-schedule";

export interface BillingScheduleRepository {
  save(tx: Transaction, schedule: BillingSchedule): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<BillingSchedule | null>;
  findByTerm(tx: Transaction, ctx: TenantContext, termId: string): Promise<BillingSchedule | null>;
  findByPolicy(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
  ): Promise<BillingSchedule | null>;
  savePaymentMethod(tx: Transaction, ctx: TenantContext, method: SavedPaymentMethod): Promise<void>;
  findPaymentMethod(
    tx: Transaction,
    ctx: TenantContext,
    id: string,
  ): Promise<SavedPaymentMethod | null>;
}

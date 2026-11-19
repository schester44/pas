import type { TenantContext, Transaction } from "@pas/kernel";
import type { Invoice, InvoiceId, PaymentProps } from "../domain/invoice";

export interface InvoiceRepository {
  save(tx: Transaction, invoice: Invoice): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: InvoiceId): Promise<Invoice | null>;
  findByTransaction(
    tx: Transaction,
    ctx: TenantContext,
    transactionId: string,
  ): Promise<Invoice | null>;
  listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string): Promise<Invoice[]>;
  listByPolicies(
    tx: Transaction,
    ctx: TenantContext,
    policyIds: readonly string[],
  ): Promise<Invoice[]>;
  listAll(tx: Transaction, ctx: TenantContext): Promise<Invoice[]>;
  listBySchedule(tx: Transaction, ctx: TenantContext, scheduleId: string): Promise<Invoice[]>;
  nextSequence(tx: Transaction, ctx: TenantContext): Promise<number>;
  addPayment(tx: Transaction, ctx: TenantContext, payment: PaymentProps): Promise<void>;
  findPayment(
    tx: Transaction,
    ctx: TenantContext,
    provider: string,
    providerRef: string,
  ): Promise<PaymentProps | null>;
  listPayments(tx: Transaction, ctx: TenantContext, policyId: string): Promise<PaymentProps[]>;
}

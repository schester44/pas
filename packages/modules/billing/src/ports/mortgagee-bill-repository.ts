import type { TenantContext, Transaction } from "@pas/kernel";
import type { MortgageeBill } from "../domain/mortgagee-bill";

export interface MortgageeBillRepository {
  save(tx: Transaction, ctx: TenantContext, bill: MortgageeBill): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<MortgageeBill | null>;
  findByInvoice(
    tx: Transaction,
    ctx: TenantContext,
    invoiceId: string,
  ): Promise<MortgageeBill | null>;
  latestForPolicy(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
  ): Promise<MortgageeBill | null>;
}

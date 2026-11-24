import type { TenantContext, Transaction } from "@pas/kernel";
import type { Offering, OfferingId } from "../domain/offering";

export interface OfferingRepository {
  save(tx: Transaction, offering: Offering): Promise<void>;
  existsByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<boolean>;
  findById(tx: Transaction, ctx: TenantContext, id: OfferingId): Promise<Offering | null>;
  list(tx: Transaction, ctx: TenantContext): Promise<Offering[]>;
}

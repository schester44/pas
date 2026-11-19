import type { TenantContext, Transaction } from "@pas/kernel";
import type { Subscription } from "../domain/subscription";

export interface SubscriptionRepository {
  list(tx: Transaction, ctx: TenantContext): Promise<Subscription[]>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Subscription | null>;
  save(tx: Transaction, subscription: Subscription): Promise<void>;
  delete(tx: Transaction, ctx: TenantContext, id: string): Promise<void>;
}

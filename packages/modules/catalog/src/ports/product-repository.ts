import type { TenantContext, Transaction } from "@pas/kernel";
import type { Product } from "../domain/product";

export interface ProductRepository {
  save(tx: Transaction, product: Product): Promise<void>;
  existsByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<boolean>;
  list(tx: Transaction, ctx: TenantContext): Promise<Product[]>;
}

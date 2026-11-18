import type { TenantContext, Transaction } from "@pas/kernel";
import type { Product, ProductId } from "../domain/product";

export interface ProductRepository {
  save(tx: Transaction, product: Product): Promise<void>;
  existsByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<boolean>;
  findById(tx: Transaction, ctx: TenantContext, id: ProductId): Promise<Product | null>;
  findByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<Product | null>;
  list(tx: Transaction, ctx: TenantContext): Promise<Product[]>;
}

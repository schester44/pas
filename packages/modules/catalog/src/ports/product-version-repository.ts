import type { TenantContext, Transaction } from "@pas/kernel";
import type { ProductId } from "../domain/product";
import type { ProductVersion, ProductVersionId } from "../domain/product-version";

export interface ProductVersionRepository {
  save(tx: Transaction, version: ProductVersion): Promise<void>;
  findById(
    tx: Transaction,
    ctx: TenantContext,
    id: ProductVersionId,
  ): Promise<ProductVersion | null>;
  listByProduct(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
  ): Promise<ProductVersion[]>;
  existsByLabel(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
    version: string,
  ): Promise<boolean>;
}

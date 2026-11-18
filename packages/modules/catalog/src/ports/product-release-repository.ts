import type { Jurisdiction, TenantContext, Transaction } from "@pas/kernel";
import type { ProductId } from "../domain/product";
import type { ProductRelease, ProductReleaseId } from "../domain/product-release";

export interface ProductReleaseRepository {
  insert(tx: Transaction, releases: readonly ProductRelease[]): Promise<void>;
  findById(
    tx: Transaction,
    ctx: TenantContext,
    id: ProductReleaseId,
  ): Promise<ProductRelease | null>;
  listByProduct(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
  ): Promise<ProductRelease[]>;
  /** Releases for the jurisdiction whose version is still offered (not retired). */
  listResolvable(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
    jurisdiction: Jurisdiction,
  ): Promise<ProductRelease[]>;
  /** Every release of a still-offered version, across the tenant's products. */
  listOffered(tx: Transaction, ctx: TenantContext): Promise<ProductRelease[]>;
}

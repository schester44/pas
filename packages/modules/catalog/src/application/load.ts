import { asId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import type { Product } from "../domain/product";
import type { ProductVersion } from "../domain/product-version";
import type { ProductRepository } from "../ports/product-repository";
import type { ProductVersionRepository } from "../ports/product-version-repository";

export async function loadProduct(
  products: ProductRepository,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Product> {
  const product = await products.findById(tx, ctx, asId(id));

  if (!product) throw notFound("Product", id);

  return product;
}

export async function loadVersion(
  versions: ProductVersionRepository,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<ProductVersion> {
  const version = await versions.findById(tx, ctx, asId(id));

  if (!version) throw notFound("Product version", id);

  return version;
}

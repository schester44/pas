import { invalid, type TenantContext, type Transaction } from "@pas/kernel";
import type { ProductRepository } from "../ports/product-repository";

export async function productNames(
  products: ProductRepository,
  tx: Transaction,
  ctx: TenantContext,
): Promise<Map<string, string>> {
  const all = await products.list(tx, ctx);

  return new Map(all.map((p) => [p.id as string, p.toSnapshot().name]));
}

export function assertKnownProducts(names: ReadonlyMap<string, string>, ids: readonly string[]) {
  const unknown = ids.filter((id) => !names.has(id));

  if (unknown.length > 0) throw invalid("Some products don't exist", { productIds: unknown });
}

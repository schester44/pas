import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ProductRepository } from "../ports/product-repository";
import { type ProductDto, toProductDto } from "./dto";

export function makeListProducts(deps: { uow: UnitOfWork; products: ProductRepository }) {
  return async function listProducts(ctx: TenantContext): Promise<ProductDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const products = await deps.products.list(tx, ctx);
      return products.map(toProductDto);
    });
  };
}

export type ListProducts = ReturnType<typeof makeListProducts>;

import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ProductRepository } from "../ports/product-repository";
import { type ProductDto, toProductDto } from "./dto";
import { loadProduct } from "./load";

export function makeGetProduct(deps: { uow: UnitOfWork; products: ProductRepository }) {
  return async function getProduct(ctx: TenantContext, input: { id: string }): Promise<ProductDto> {
    return deps.uow.run(ctx, async (tx) =>
      toProductDto(await loadProduct(deps.products, tx, ctx, input.id)),
    );
  };
}

export type GetProduct = ReturnType<typeof makeGetProduct>;

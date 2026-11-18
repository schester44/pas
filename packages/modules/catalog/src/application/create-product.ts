import {
  type Clock,
  conflict,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { Product } from "../domain/product";
import type { ProductRepository } from "../ports/product-repository";
import { type ProductDto, toProductDto } from "./dto";

export interface CreateProductInput {
  key: string;
  name: string;
  lineOfBusiness: string;
}

export function makeCreateProduct(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  products: ProductRepository;
  clock: Clock;
}) {
  return async function createProduct(
    ctx: TenantContext,
    input: CreateProductInput,
  ): Promise<ProductDto> {
    return deps.uow.run(ctx, async (tx) => {
      const product = Product.create({ tenantId: ctx.tenantId, ...input }, deps.clock);

      if (await deps.products.existsByKey(tx, ctx, product.toSnapshot().key)) {
        throw conflict(`A product with key "${input.key}" already exists`);
      }

      await deps.products.save(tx, product);
      await deps.outbox.add(tx, product.pullEvents());

      return toProductDto(product);
    });
  };
}

export type CreateProduct = ReturnType<typeof makeCreateProduct>;

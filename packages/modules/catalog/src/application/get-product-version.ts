import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { type ProductVersionDto, toVersionDto } from "./dto";
import { loadVersion } from "./load";

export function makeGetProductVersion(deps: {
  uow: UnitOfWork;
  versions: ProductVersionRepository;
}) {
  return async function getProductVersion(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<ProductVersionDto> {
    return deps.uow.run(ctx, async (tx) =>
      toVersionDto(await loadVersion(deps.versions, tx, ctx, input.id)),
    );
  };
}

export type GetProductVersion = ReturnType<typeof makeGetProductVersion>;

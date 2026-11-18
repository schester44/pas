import { asId, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { type ProductVersionSummaryDto, toVersionSummaryDto } from "./dto";

export function makeListProductVersions(deps: {
  uow: UnitOfWork;
  versions: ProductVersionRepository;
}) {
  return async function listProductVersions(
    ctx: TenantContext,
    input: { productId: string },
  ): Promise<ProductVersionSummaryDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const versions = await deps.versions.listByProduct(tx, ctx, asId(input.productId));

      return versions.map(toVersionSummaryDto);
    });
  };
}

export type ListProductVersions = ReturnType<typeof makeListProductVersions>;

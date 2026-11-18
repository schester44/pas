import { asId, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import { type ProductReleaseDto, toReleaseDto } from "./dto";

export function makeListProductReleases(deps: {
  uow: UnitOfWork;
  releases: ProductReleaseRepository;
}) {
  return async function listProductReleases(
    ctx: TenantContext,
    input: { productId: string },
  ): Promise<ProductReleaseDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const releases = await deps.releases.listByProduct(tx, ctx, asId(input.productId));

      return releases.map(toReleaseDto);
    });
  };
}

export type ListProductReleases = ReturnType<typeof makeListProductReleases>;

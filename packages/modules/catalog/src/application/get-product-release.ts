import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import { type ResolvedReleaseDto, toResolvedReleaseDto } from "./dto";

export function makeGetProductRelease(deps: {
  uow: UnitOfWork;
  releases: ProductReleaseRepository;
}) {
  return async function getProductRelease(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<ResolvedReleaseDto> {
    return deps.uow.run(ctx, async (tx) => {
      const release = await deps.releases.findById(tx, ctx, asId(input.id));

      if (!release) throw notFound("Product release", input.id);

      return toResolvedReleaseDto(release);
    });
  };
}

export type GetProductRelease = ReturnType<typeof makeGetProductRelease>;

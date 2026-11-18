import {
  asId,
  jurisdiction,
  type Jurisdiction,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { AvailabilityKind } from "../domain/availability";
import { selectRelease } from "../domain/product-release";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import type { ProductRepository } from "../ports/product-repository";
import { type ResolvedReleaseDto, toResolvedReleaseDto } from "./dto";

export type ResolveReleaseInput = ({ productKey: string } | { productId: string }) & {
  jurisdiction: Jurisdiction;
  effectiveDate: string;
  kind: AvailabilityKind;
};

export function makeResolveRelease(deps: {
  uow: UnitOfWork;
  products: ProductRepository;
  releases: ProductReleaseRepository;
}) {
  return async function resolveRelease(
    ctx: TenantContext,
    input: ResolveReleaseInput,
  ): Promise<ResolvedReleaseDto | null> {
    const where = jurisdiction(input.jurisdiction.country, input.jurisdiction.subdivision);
    const date = parsePlainDate(input.effectiveDate);

    return deps.uow.run(ctx, async (tx) => {
      const product =
        "productId" in input
          ? await deps.products.findById(tx, ctx, asId(input.productId))
          : await deps.products.findByKey(tx, ctx, input.productKey);

      if (!product) return null;

      const candidates = await deps.releases.listResolvable(tx, ctx, product.id, where);
      const release = selectRelease(candidates, where, date, input.kind);

      return release ? toResolvedReleaseDto(release) : null;
    });
  };
}

export type ResolveRelease = ReturnType<typeof makeResolveRelease>;

import {
  asId,
  jurisdiction,
  type Jurisdiction,
  notFound,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { AvailabilityKind } from "../domain/availability";
import { selectRelease } from "../domain/product-release";
import type { OfferingRepository } from "../ports/offering-repository";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import type { ProductRepository } from "../ports/product-repository";
import { type ResolvedReleaseDto, toResolvedReleaseDto } from "./dto";

export interface ResolveOfferingInput {
  offeringId: string;
  jurisdiction: Jurisdiction;
  effectiveDate: string;
  kind: AvailabilityKind;
}

export interface ResolvedOfferingDto {
  id: string;
  name: string;
  selection: string;
  active: boolean;
  /** One per active member with a release there, in member order (PLAN §6.0). */
  releases: ResolvedReleaseDto[];
}

export function makeResolveOffering(deps: {
  uow: UnitOfWork;
  offerings: OfferingRepository;
  products: ProductRepository;
  releases: ProductReleaseRepository;
}) {
  return async function resolveOffering(
    ctx: TenantContext,
    input: ResolveOfferingInput,
  ): Promise<ResolvedOfferingDto> {
    const where = jurisdiction(input.jurisdiction.country, input.jurisdiction.subdivision);
    const date = parsePlainDate(input.effectiveDate);

    return deps.uow.run(ctx, async (tx) => {
      const offering = await deps.offerings.findById(tx, ctx, asId(input.offeringId));

      if (!offering) throw notFound("Offering", input.offeringId);

      const o = offering.toSnapshot();

      const releases = await Promise.all(
        o.productIds.map(async (productId) => {
          const product = await deps.products.findById(tx, ctx, asId(productId));

          if (product?.toSnapshot().status !== "active") return null;

          const candidates = await deps.releases.listResolvable(tx, ctx, product.id, where);

          return selectRelease(candidates, where, date, input.kind);
        }),
      );

      return {
        id: o.id,
        name: o.name,
        selection: o.selection,
        active: offering.isActive,
        releases: releases.flatMap((release) => (release ? [toResolvedReleaseDto(release)] : [])),
      };
    });
  };
}

export type ResolveOffering = ReturnType<typeof makeResolveOffering>;

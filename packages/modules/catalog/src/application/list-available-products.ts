import {
  jurisdiction,
  type Jurisdiction,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { type AvailabilityKind, dateWindowToJson } from "../domain/availability";
import { type ProductRelease, selectRelease } from "../domain/product-release";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import type { ProductRepository } from "../ports/product-repository";
import { type AvailableProductDto, toProductDto } from "./dto";

export interface ListAvailableProductsInput {
  kind: AvailabilityKind;
  at?: { jurisdiction: Jurisdiction; effectiveDate: string };
}

export function makeListAvailableProducts(deps: {
  uow: UnitOfWork;
  products: ProductRepository;
  releases: ProductReleaseRepository;
}) {
  return async function listAvailableProducts(
    ctx: TenantContext,
    input: ListAvailableProductsInput,
  ): Promise<AvailableProductDto[]> {
    const at = input.at && {
      where: jurisdiction(input.at.jurisdiction.country, input.at.jurisdiction.subdivision),
      date: parsePlainDate(input.at.effectiveDate),
    };

    return deps.uow.run(ctx, async (tx) => {
      const [products, releases] = await Promise.all([
        deps.products.list(tx, ctx),
        deps.releases.listOffered(tx, ctx),
      ]);

      const byProduct = Map.groupBy(releases, (release) => release.toSnapshot().productId);

      return products.flatMap((product) => {
        const offered = byProduct.get(product.id) ?? [];

        if (product.toSnapshot().status !== "active" || offered.length === 0) return [];

        if (at && !selectRelease(offered, at.where, at.date, input.kind)) return [];

        return [{ ...toProductDto(product), availability: availabilityOf(offered, input.kind) }];
      });
    });
  };
}

function availabilityOf(releases: ProductRelease[], kind: AvailabilityKind) {
  return releases
    .map((release) => ({
      jurisdiction: release.toSnapshot().jurisdiction,
      ...dateWindowToJson(release.windowFor(kind)),
    }))
    .toSorted(
      (a, b) =>
        (a.jurisdiction.subdivision ?? a.jurisdiction.country).localeCompare(
          b.jurisdiction.subdivision ?? b.jurisdiction.country,
        ) || a.from.localeCompare(b.from),
    );
}

export type ListAvailableProducts = ReturnType<typeof makeListAvailableProducts>;

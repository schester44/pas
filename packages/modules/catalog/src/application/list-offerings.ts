import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { OfferingRepository } from "../ports/offering-repository";
import type { ProductRepository } from "../ports/product-repository";
import { type OfferingDto, toOfferingDto } from "./dto";
import { productNames } from "./offering-members";

export function makeListOfferings(deps: {
  uow: UnitOfWork;
  offerings: OfferingRepository;
  products: ProductRepository;
}) {
  return async function listOfferings(ctx: TenantContext): Promise<OfferingDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const [offerings, names] = await Promise.all([
        deps.offerings.list(tx, ctx),
        productNames(deps.products, tx, ctx),
      ]);

      return offerings.map((offering) => toOfferingDto(offering, names));
    });
  };
}

export type ListOfferings = ReturnType<typeof makeListOfferings>;

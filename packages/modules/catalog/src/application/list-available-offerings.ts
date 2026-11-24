import type { TenantContext } from "@pas/kernel";
import type { OfferingRepository } from "../ports/offering-repository";
import type { AvailableOfferingDto } from "./dto";
import {
  type AvailabilityDeps,
  availableProducts,
  type ListAvailableProductsInput,
} from "./list-available-products";

/** Active offerings with at least one member open for business; windows are the members' union. */
export function makeListAvailableOfferings(
  deps: AvailabilityDeps & { offerings: OfferingRepository },
) {
  return async function listAvailableOfferings(
    ctx: TenantContext,
    input: ListAvailableProductsInput,
  ): Promise<AvailableOfferingDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const [offerings, products] = await Promise.all([
        deps.offerings.list(tx, ctx),
        availableProducts(deps, tx, ctx, input),
      ]);

      const byId = new Map(products.map((p) => [p.id, p]));

      return offerings.flatMap((offering) => {
        const o = offering.toSnapshot();
        const members = o.productIds.flatMap((id) => byId.get(id) ?? []);

        if (!offering.isActive || members.length === 0) return [];

        return [{ id: o.id, name: o.name, availability: members.flatMap((m) => m.availability) }];
      });
    });
  };
}

export type ListAvailableOfferings = ReturnType<typeof makeListAvailableOfferings>;

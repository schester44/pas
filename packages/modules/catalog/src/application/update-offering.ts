import {
  asId,
  type ClockProvider,
  notFound,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { OfferingInput } from "../domain/offering";
import type { OfferingRepository } from "../ports/offering-repository";
import type { ProductRepository } from "../ports/product-repository";
import { type OfferingDto, toOfferingDto } from "./dto";
import { assertKnownProducts, productNames } from "./offering-members";

export type UpdateOfferingInput = OfferingInput & { id: string; active: boolean };

/** Takes effect for submissions started afterwards; started ones keep their pinned candidates. */
export function makeUpdateOffering(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  offerings: OfferingRepository;
  products: ProductRepository;
  clocks: ClockProvider;
}) {
  return async function updateOffering(
    ctx: TenantContext,
    input: UpdateOfferingInput,
  ): Promise<OfferingDto> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    return deps.uow.run(ctx, async (tx) => {
      const offering = await deps.offerings.findById(tx, ctx, asId(input.id));

      if (!offering) throw notFound("Offering", input.id);

      const names = await productNames(deps.products, tx, ctx);
      assertKnownProducts(names, input.productIds);

      offering.update(input, clock);

      if (input.active) offering.activate(clock);
      else offering.retire(clock);

      await deps.offerings.save(tx, offering);
      await deps.outbox.add(tx, offering.pullEvents());

      return toOfferingDto(offering, names);
    });
  };
}

export type UpdateOffering = ReturnType<typeof makeUpdateOffering>;

import {
  type ClockProvider,
  conflict,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { Offering, type OfferingInput } from "../domain/offering";
import type { OfferingRepository } from "../ports/offering-repository";
import type { ProductRepository } from "../ports/product-repository";
import { type OfferingDto, toOfferingDto } from "./dto";
import { assertKnownProducts, productNames } from "./offering-members";

export type CreateOfferingInput = OfferingInput & { key: string };

export function makeCreateOffering(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  offerings: OfferingRepository;
  products: ProductRepository;
  clocks: ClockProvider;
}) {
  return async function createOffering(
    ctx: TenantContext,
    input: CreateOfferingInput,
  ): Promise<OfferingDto> {
    return deps.uow.run(ctx, async (tx) => {
      const names = await productNames(deps.products, tx, ctx);
      assertKnownProducts(names, input.productIds);

      const offering = Offering.create(
        { tenantId: ctx.tenantId, ...input },
        deps.clocks.forTenant(ctx.tenantId),
      );

      if (await deps.offerings.existsByKey(tx, ctx, offering.toSnapshot().key)) {
        throw conflict(`An offering with key "${input.key}" already exists`);
      }

      await deps.offerings.save(tx, offering);
      await deps.outbox.add(tx, offering.pullEvents());

      return toOfferingDto(offering, names);
    });
  };
}

export type CreateOffering = ReturnType<typeof makeCreateOffering>;

import {
  conflict,
  invalid,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import { ProductVersion } from "../domain/product-version";
import type { ProductRepository } from "../ports/product-repository";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { type ProductVersionDto, toVersionDto } from "./dto";
import { loadProduct, loadVersion } from "./load";

export interface CreateProductVersionInput {
  productId: string;
  version: string;
  copyFromId?: string;
}

export function makeCreateProductVersion(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  products: ProductRepository;
  versions: ProductVersionRepository;
  clocks: ClockProvider;
}) {
  return async function createProductVersion(
    ctx: TenantContext,
    input: CreateProductVersionInput,
  ): Promise<ProductVersionDto> {
    return deps.uow.run(ctx, async (tx) => {
      const product = await loadProduct(deps.products, tx, ctx, input.productId);

      const basedOn = input.copyFromId
        ? await loadVersion(deps.versions, tx, ctx, input.copyFromId)
        : undefined;

      if (basedOn && basedOn.toSnapshot().productId !== product.id) {
        throw invalid("Copy a version of the same product");
      }

      const draft = ProductVersion.draft(
        { tenantId: ctx.tenantId, productId: product.id, version: input.version, basedOn },
        deps.clocks.forTenant(ctx.tenantId),
      );

      const label = draft.toSnapshot().version;

      if (await deps.versions.existsByLabel(tx, ctx, product.id, label)) {
        throw conflict(`Version ${label} already exists. Choose another label.`, {
          field: "version",
        });
      }

      await deps.versions.save(tx, draft);
      await deps.outbox.add(tx, draft.pullEvents());

      return toVersionDto(draft);
    });
  };
}

export type CreateProductVersion = ReturnType<typeof makeCreateProductVersion>;

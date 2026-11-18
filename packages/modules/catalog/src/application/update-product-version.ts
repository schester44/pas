import type { TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import {
  fromContentsDto,
  type ProductVersionDto,
  toVersionDto,
  type VersionContentsDto,
} from "./dto";
import { loadVersion } from "./load";

export type UpdateProductVersionInput = { id: string } & Partial<VersionContentsDto>;

export function makeUpdateProductVersion(deps: {
  uow: UnitOfWork;
  versions: ProductVersionRepository;
  clocks: ClockProvider;
}) {
  return async function updateProductVersion(
    ctx: TenantContext,
    { id, ...changes }: UpdateProductVersionInput,
  ): Promise<ProductVersionDto> {
    return deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps.versions, tx, ctx, id);
      version.update(fromContentsDto(changes), deps.clocks.forTenant(ctx.tenantId));
      await deps.versions.save(tx, version);

      return toVersionDto(version);
    });
  };
}

export type UpdateProductVersion = ReturnType<typeof makeUpdateProductVersion>;

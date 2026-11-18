import type { Clock, Outbox, TenantContext, UnitOfWork } from "@pas/kernel";
import type { ProductVersion } from "../domain/product-version";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { type ProductVersionDto, toVersionDto } from "./dto";
import { loadVersion } from "./load";

export interface VersionTransitionDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  versions: ProductVersionRepository;
  clock: Clock;
}

export function makeVersionTransition(
  deps: VersionTransitionDeps,
  apply: (version: ProductVersion, clock: Clock) => void,
) {
  return (ctx: TenantContext, input: { id: string }): Promise<ProductVersionDto> =>
    deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps.versions, tx, ctx, input.id);
      apply(version, deps.clock);
      await deps.versions.save(tx, version);
      await deps.outbox.add(tx, version.pullEvents());

      return toVersionDto(version);
    });
}

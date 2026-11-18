import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { FormEditionRepository } from "../ports/form-edition-repository";

export function makeFindExistingFormEditions(deps: {
  uow: UnitOfWork;
  editions: FormEditionRepository;
}) {
  return async function findExistingFormEditions(
    ctx: TenantContext,
    ids: readonly string[],
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    return deps.uow.run(ctx, (tx) => deps.editions.existingIds(tx, ctx, ids));
  };
}

export type FindExistingFormEditions = ReturnType<typeof makeFindExistingFormEditions>;

import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { FormEditionRepository } from "../ports/form-edition-repository";
import { type FormEditionDto, toFormEditionDto } from "./dto";

export function makeListFormEditions(deps: { uow: UnitOfWork; editions: FormEditionRepository }) {
  return async function listFormEditions(ctx: TenantContext): Promise<FormEditionDto[]> {
    return deps.uow.run(ctx, async (tx) =>
      (await deps.editions.list(tx, ctx)).map(toFormEditionDto),
    );
  };
}

export type ListFormEditions = ReturnType<typeof makeListFormEditions>;

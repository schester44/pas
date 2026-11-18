import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { FormEditionRepository } from "../ports/form-edition-repository";
import { type FormEditionDto, toFormEditionDto } from "./dto";

export function makeGetFormEditionFile(deps: {
  uow: UnitOfWork;
  editions: FormEditionRepository;
  storage: ObjectStorage;
}) {
  return async function getFormEditionFile(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<{ edition: FormEditionDto; body: Uint8Array }> {
    const edition = await deps.uow.run(ctx, (tx) =>
      deps.editions.findById(tx, ctx, asId(input.id)),
    );

    if (!edition) throw notFound("Form edition", input.id);

    const file = await deps.storage.get(edition.toSnapshot().file.storageKey);

    if (!file) throw notFound("Form edition file", input.id);

    return { edition: toFormEditionDto(edition), body: file.body };
  };
}

export type GetFormEditionFile = ReturnType<typeof makeGetFormEditionFile>;

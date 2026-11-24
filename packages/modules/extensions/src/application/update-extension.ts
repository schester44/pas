import type { TenantContext } from "@pas/kernel";
import type { ExtensionDraft } from "../domain/extension";
import type { ExtensionDeps } from "./deps";
import { type ExtensionDto, toExtensionDto } from "./dto";
import { loadExtension } from "./load";

export function makeUpdateExtension(deps: Pick<ExtensionDeps, "uow" | "extensions" | "clocks">) {
  return async function updateExtension(
    ctx: TenantContext,
    input: {
      id: string;
      name?: string;
      description?: string | null;
      draft?: Partial<ExtensionDraft>;
    },
  ): Promise<ExtensionDto> {
    return deps.uow.run(ctx, async (tx) => {
      const extension = await loadExtension(deps.extensions, tx, ctx, input.id);
      const clock = deps.clocks.forTenant(ctx.tenantId);
      const current = extension.toSnapshot();

      if (input.name !== undefined || input.description !== undefined) {
        extension.describe(
          {
            name: input.name ?? current.name,
            description: input.description === undefined ? current.description : input.description,
          },
          clock,
        );
      }

      if (input.draft) extension.editDraft(input.draft, clock);

      await deps.extensions.save(tx, extension);

      return toExtensionDto(extension);
    });
  };
}

export type UpdateExtension = ReturnType<typeof makeUpdateExtension>;

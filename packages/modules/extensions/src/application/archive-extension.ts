import type { TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";
import { type ExtensionDto, toExtensionDto } from "./dto";
import { loadExtension } from "./load";

/** Archiving hides an extension from pickers; pinned versions keep running where they're bound. */
export function makeArchiveExtension(deps: Pick<ExtensionDeps, "uow" | "extensions" | "clocks">) {
  return async function archiveExtension(
    ctx: TenantContext,
    input: { id: string; archived: boolean },
  ): Promise<ExtensionDto> {
    return deps.uow.run(ctx, async (tx) => {
      const extension = await loadExtension(deps.extensions, tx, ctx, input.id);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      if (input.archived) extension.archive(clock);
      else extension.restoreFromArchive(clock);

      await deps.extensions.save(tx, extension);

      return toExtensionDto(extension);
    });
  };
}

export type ArchiveExtension = ReturnType<typeof makeArchiveExtension>;

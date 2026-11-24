import { conflict, type TenantContext } from "@pas/kernel";
import { Extension } from "../domain/extension";
import type { ExtensionDeps } from "./deps";
import { type ExtensionDto, toExtensionDto } from "./dto";

export function makeCreateExtension(deps: Pick<ExtensionDeps, "uow" | "extensions" | "clocks">) {
  return async function createExtension(
    ctx: TenantContext,
    input: { key: string; name: string; description?: string | null },
  ): Promise<ExtensionDto> {
    return deps.uow.run(ctx, async (tx) => {
      if (await deps.extensions.findByKey(tx, ctx, input.key.trim())) {
        throw conflict(`An extension with key ${input.key} already exists`, { field: "key" });
      }

      const extension = Extension.create(
        { tenantId: ctx.tenantId, ...input },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.extensions.save(tx, extension);

      return toExtensionDto(extension);
    });
  };
}

export type CreateExtension = ReturnType<typeof makeCreateExtension>;

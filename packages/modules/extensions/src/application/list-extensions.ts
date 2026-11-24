import type { TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";
import { type ExtensionDto, toExtensionDto } from "./dto";

export function makeListExtensions(deps: Pick<ExtensionDeps, "uow" | "extensions">) {
  return async function listExtensions(ctx: TenantContext): Promise<ExtensionDto[]> {
    return deps.uow.run(ctx, async (tx) =>
      (await deps.extensions.list(tx, ctx)).map(toExtensionDto),
    );
  };
}

export type ListExtensions = ReturnType<typeof makeListExtensions>;

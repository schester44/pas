import type { TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";
import {
  type ExtensionDetailDto,
  type ExtensionVersionDetailDto,
  toExtensionDto,
  toSecretDto,
  toSubscriptionDto,
  toVersionDetailDto,
  toVersionDto,
} from "./dto";
import { loadExtension, loadVersion } from "./load";

export function makeGetExtension(
  deps: Pick<ExtensionDeps, "uow" | "extensions" | "subscriptions">,
) {
  return async function getExtension(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<ExtensionDetailDto> {
    return deps.uow.run(ctx, async (tx) => {
      const extension = await loadExtension(deps.extensions, tx, ctx, input.id);

      const [versions, secrets, subscriptions] = await Promise.all([
        deps.extensions.versions(tx, ctx, extension.id),
        deps.extensions.secrets(tx, ctx, extension.id),
        deps.subscriptions.forExtension(tx, ctx, extension.id),
      ]);

      return {
        ...toExtensionDto(extension),
        draft: extension.draft,
        versions: versions.toSorted((a, b) => b.version - a.version).map(toVersionDto),
        secrets: secrets.map(toSecretDto),
        subscriptions: subscriptions.map(toSubscriptionDto),
      };
    });
  };
}

export function makeGetExtensionVersion(deps: Pick<ExtensionDeps, "uow" | "extensions">) {
  return async function getExtensionVersion(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<ExtensionVersionDetailDto> {
    return deps.uow.run(ctx, async (tx) =>
      toVersionDetailDto(await loadVersion(deps.extensions, tx, ctx, input.id)),
    );
  };
}

export type GetExtension = ReturnType<typeof makeGetExtension>;
export type GetExtensionVersion = ReturnType<typeof makeGetExtensionVersion>;

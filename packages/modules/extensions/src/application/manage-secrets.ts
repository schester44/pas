import { invalid, type TenantContext } from "@pas/kernel";
import { SECRET_NAME } from "../domain/manifest";
import { hintOf, secretContext } from "../domain/secret";
import type { ExtensionDeps } from "./deps";
import { loadExtension } from "./load";

const MAX_SECRET_LENGTH = 8_192;

export function makeSetExtensionSecret(
  deps: Pick<ExtensionDeps, "uow" | "extensions" | "secrets" | "clocks">,
) {
  return async function setExtensionSecret(
    ctx: TenantContext,
    input: { extensionId: string; name: string; value: string },
  ): Promise<{ name: string; hint: string }> {
    const name = input.name.trim();

    if (!SECRET_NAME.test(name)) {
      throw invalid("Use letters, digits and _ for the secret name, like API_KEY", {
        field: "name",
      });
    }

    if (!input.value || input.value.length > MAX_SECRET_LENGTH) {
      throw invalid("Enter the secret value", { field: "value" });
    }

    return deps.uow.run(ctx, async (tx) => {
      const extension = await loadExtension(deps.extensions, tx, ctx, input.extensionId);
      const hint = hintOf(input.value);

      await deps.extensions.putSecret(tx, ctx, {
        extensionId: extension.id,
        name,
        sealed: deps.secrets.seal(input.value, secretContext(ctx.tenantId, extension.id, name)),
        hint,
        at: deps.clocks.forTenant(ctx.tenantId).now(),
      });

      return { name, hint };
    });
  };
}

export function makeRemoveExtensionSecret(deps: Pick<ExtensionDeps, "uow" | "extensions">) {
  return async function removeExtensionSecret(
    ctx: TenantContext,
    input: { extensionId: string; name: string },
  ): Promise<void> {
    await deps.uow.run(ctx, async (tx) => {
      const extension = await loadExtension(deps.extensions, tx, ctx, input.extensionId);

      await deps.extensions.deleteSecret(tx, ctx, { extensionId: extension.id, name: input.name });
    });
  };
}

export type SetExtensionSecret = ReturnType<typeof makeSetExtensionSecret>;
export type RemoveExtensionSecret = ReturnType<typeof makeRemoveExtensionSecret>;

import { type ExtensionPoint, POINT_SPECS } from "@pas/extension-points";
import { asId, type TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";

export interface BindingReference {
  bindingId?: string;
  point: ExtensionPoint;
  extensionVersionId: string;
}

export interface BindingIssue {
  bindingId?: string;
  severity: "error" | "warning";
  message: string;
}

/** For catalog's publish gate: every referenced version exists and implements its point. */
export function makeVerifyBindings(deps: Pick<ExtensionDeps, "uow" | "extensions">) {
  return async function verifyBindings(
    ctx: TenantContext,
    references: readonly BindingReference[],
  ): Promise<BindingIssue[]> {
    if (references.length === 0) return [];

    const { versions, extensions } = await deps.uow.run(ctx, async (tx) => ({
      versions: await deps.extensions.findVersions(
        tx,
        ctx,
        [...new Set(references.map((r) => r.extensionVersionId))].map((id) => asId(id)),
      ),
      extensions: await deps.extensions.list(tx, ctx),
    }));

    const byId = new Map(versions.map((v) => [v.id as string, v]));
    const names = new Map(extensions.map((e) => [e.id as string, e.toSnapshot()]));

    return references.flatMap((ref): BindingIssue[] => {
      const version = byId.get(ref.extensionVersionId);
      const at = ref.bindingId ? { bindingId: ref.bindingId } : {};
      const label = POINT_SPECS[ref.point].label;

      if (!version) {
        return [
          {
            ...at,
            severity: "error",
            message: `${label}: the chosen extension version doesn't exist`,
          },
        ];
      }

      const extension = names.get(version.extensionId);
      const name = `${extension?.name ?? "Extension"} v${version.version}`;

      if (!version.manifest.points.includes(ref.point)) {
        return [{ ...at, severity: "error", message: `${name} doesn't implement ${ref.point}` }];
      }

      if (extension?.status === "archived") {
        return [{ ...at, severity: "warning", message: `${name} is archived` }];
      }

      return [];
    });
  };
}

export type VerifyBindings = ReturnType<typeof makeVerifyBindings>;

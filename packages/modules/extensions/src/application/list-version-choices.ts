import type { ExtensionPoint } from "@pas/extension-points";
import type { TenantContext } from "@pas/kernel";
import type { ExtensionDeps } from "./deps";

export interface VersionChoiceDto {
  extensionId: string;
  key: string;
  name: string;
  versionId: string;
  version: number;
  points: ExtensionPoint[];
  publishedAt: string;
}

/** Published versions for binding pickers, newest first; archived extensions are left out. */
export function makeListVersionChoices(deps: Pick<ExtensionDeps, "uow" | "extensions">) {
  return async function listVersionChoices(
    ctx: TenantContext,
    input: { point?: ExtensionPoint } = {},
  ): Promise<VersionChoiceDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const [extensions, versions] = await Promise.all([
        deps.extensions.list(tx, ctx),
        deps.extensions.publishedVersions(tx, ctx),
      ]);

      const active = new Map(
        extensions
          .filter((e) => e.toSnapshot().status === "active")
          .map((e) => [e.id as string, e]),
      );

      return versions
        .filter((v) => active.has(v.extensionId))
        .filter((v) => !input.point || v.manifest.points.includes(input.point))
        .map((v) => {
          const extension = active.get(v.extensionId)!.toSnapshot();

          return {
            extensionId: v.extensionId,
            key: extension.key,
            name: extension.name,
            versionId: v.id,
            version: v.version,
            points: v.manifest.points,
            publishedAt: v.publishedAt.toString(),
          };
        });
    });
  };
}

export type ListVersionChoices = ReturnType<typeof makeListVersionChoices>;

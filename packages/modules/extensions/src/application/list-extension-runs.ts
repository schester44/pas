import { asId, notFound, type TenantContext } from "@pas/kernel";
import type { ExtensionRun } from "../domain/run";
import type { ExtensionDeps } from "./deps";
import { type ExtensionRunDetailDto, type ExtensionRunDto, toRunDetailDto, toRunDto } from "./dto";

export function makeListExtensionRuns(deps: Pick<ExtensionDeps, "uow" | "runs">) {
  return async function listExtensionRuns(
    ctx: TenantContext,
    input: {
      extensionId?: string;
      subject?: { type: string; id: string };
      status?: ExtensionRun["status"];
      limit?: number;
    },
  ): Promise<ExtensionRunDto[]> {
    return deps.uow.run(ctx, async (tx) =>
      (
        await deps.runs.list(tx, ctx, {
          ...(input.extensionId && { extensionId: asId(input.extensionId) }),
          ...(input.subject && { subject: input.subject }),
          ...(input.status && { status: input.status }),
          limit: Math.min(input.limit ?? 50, 200),
        })
      ).map(toRunDto),
    );
  };
}

export function makeGetExtensionRun(deps: Pick<ExtensionDeps, "uow" | "runs">) {
  return async function getExtensionRun(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<ExtensionRunDetailDto> {
    return deps.uow.run(ctx, async (tx) => {
      const run = await deps.runs.find(tx, ctx, asId(input.id));

      if (!run) throw notFound("Extension run", input.id);

      return toRunDetailDto(run);
    });
  };
}

export type ListExtensionRuns = ReturnType<typeof makeListExtensionRuns>;
export type GetExtensionRun = ReturnType<typeof makeGetExtensionRun>;

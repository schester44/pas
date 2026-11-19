import { notFound, type TenantContext } from "@pas/kernel";
import { type ComplianceDeps, loadObligation } from "./deps";
import { type ObligationDetailDto, toDetailDto } from "./dto";

export function makeGetObligation(
  deps: Pick<ComplianceDeps, "uow" | "obligations" | "clocks" | "storage">,
) {
  return {
    async detail(ctx: TenantContext, input: { id: string }): Promise<ObligationDetailDto> {
      const obligation = await deps.uow.run(ctx, (tx) => loadObligation(deps, tx, ctx, input.id));

      return toDetailDto(obligation, deps.clocks.forTenant(ctx.tenantId).now());
    },
    async proofFile(ctx: TenantContext, input: { id: string; key: string }) {
      const obligation = await deps.uow.run(ctx, (tx) => loadObligation(deps, tx, ctx, input.id));
      const file = obligation.toSnapshot().proof?.files.find((f) => f.key === input.key);
      const stored = file && (await deps.storage.get(file.key));

      if (!file || !stored) throw notFound("Proof file", input.key);

      return { fileName: file.name, contentType: file.contentType, body: stored.body };
    },
  };
}

export type GetObligation = ReturnType<typeof makeGetObligation>;

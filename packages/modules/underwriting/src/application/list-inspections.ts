import type { TenantContext } from "@pas/kernel";
import { loadInspection, type UnderwritingDeps } from "./deps";
import { type InspectionDto, toInspectionDto } from "./dto";

export const INSPECTION_VIEWS = ["review", "pending", "done", "all"] as const;

export type InspectionView = (typeof INSPECTION_VIEWS)[number];

const STATUSES: Record<InspectionView, string[] | undefined> = {
  review: ["completed"],
  pending: ["requested", "ordered", "scheduled"],
  done: ["reviewed", "cancelled"],
  all: undefined,
};

export function makeListInspections(deps: UnderwritingDeps) {
  return {
    async list(ctx: TenantContext, input: { view?: InspectionView }): Promise<InspectionDto[]> {
      const statuses = STATUSES[input.view ?? "review"];

      const list = await deps.uow.run(ctx, (tx) =>
        deps.inspections.list(tx, ctx, { ...(statuses && { statuses }), limit: 200 }),
      );

      return list.map(toInspectionDto);
    },

    async forQuote(ctx: TenantContext, input: { quoteId: string }): Promise<InspectionDto[]> {
      const list = await deps.uow.run(ctx, (tx) =>
        deps.inspections.listByQuote(tx, ctx, input.quoteId),
      );

      return list.map(toInspectionDto);
    },

    async forPolicy(ctx: TenantContext, input: { policyId: string }): Promise<InspectionDto[]> {
      const list = await deps.uow.run(ctx, (tx) =>
        deps.inspections.listByPolicy(tx, ctx, input.policyId),
      );

      return list.map(toInspectionDto);
    },

    async get(ctx: TenantContext, input: { id: string }): Promise<InspectionDto> {
      return toInspectionDto(
        await deps.uow.run(ctx, (tx) => loadInspection(deps, tx, ctx, input.id)),
      );
    },
  };
}

import { notFound, type TenantContext } from "@pas/kernel";
import type { CarrierDeps } from "./deps";
import { toExchangeDto, toRunDto } from "./dto";

export function makeFlowRuns(deps: CarrierDeps) {
  const get = (ctx: TenantContext, input: { id: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const run = await deps.runs.findById(tx, ctx, input.id);

      if (!run) throw notFound("CarrierFlowRun", input.id);

      const exchanges = await deps.runs.exchanges(tx, ctx, run.id);

      return { ...toRunDto(run), exchanges: exchanges.map(toExchangeDto) };
    });

  const list = (ctx: TenantContext, input: { carrierId: string; limit?: number }) =>
    deps.uow.run(ctx, async (tx) =>
      (await deps.runs.list(tx, ctx, { carrierId: input.carrierId, limit: input.limit ?? 50 })).map(
        toRunDto,
      ),
    );

  /** Carrier conversations about one quote or policy, newest first. */
  const forSubject = (ctx: TenantContext, input: { field: "quoteId" | "policyId"; id: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const runs = await deps.runs.list(tx, ctx, {
        subjectKey: { field: input.field, value: input.id },
        limit: 50,
      });

      const carriers = new Map((await deps.carriers.list(tx, ctx)).map((c) => [c.id, c.name]));

      return runs.map((run) => ({
        ...toRunDto(run),
        carrierName: carriers.get(run.carrierId) ?? "Carrier",
      }));
    });

  return { get, list, forSubject };
}

export type FlowRuns = ReturnType<typeof makeFlowRuns>;

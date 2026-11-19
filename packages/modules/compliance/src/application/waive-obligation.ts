import type { TenantContext } from "@pas/kernel";
import { type ComplianceDeps, loadObligation, persist } from "./deps";
import { type ObligationDetailDto, toDetailDto } from "./dto";

/** Waives an obligation that no longer applies; the reason and approver are kept as proof. */
export function makeWaiveObligation(deps: ComplianceDeps) {
  return async function waiveObligation(
    ctx: TenantContext,
    input: { obligationId: string; reason: string; approverName: string },
  ): Promise<ObligationDetailDto> {
    const clock = deps.clocks.forTenant(ctx.tenantId);
    const approverId = ctx.actor.type === "user" ? ctx.actor.userId : null;

    return deps.uow.run(ctx, async (tx) => {
      const obligation = await loadObligation(deps, tx, ctx, input.obligationId);

      obligation.waive(
        { reason: input.reason, approver: { id: approverId, name: input.approverName } },
        clock,
      );

      await persist(deps, tx, obligation);

      return toDetailDto(obligation, clock.now());
    });
  };
}

export type WaiveObligation = ReturnType<typeof makeWaiveObligation>;

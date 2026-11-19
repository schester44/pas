import { invalid, type TenantContext } from "@pas/kernel";
import { clockOf, loadReferral, persist, personOf, type UnderwritingDeps } from "./deps";

/** Claim a referral, hand it to a colleague, or put it back in the queue. */
export function makeAssignReferral(deps: UnderwritingDeps) {
  return async function assignReferral(
    ctx: TenantContext,
    input: { id: string; assigneeId: string | null; actorName: string },
  ) {
    const assignee = input.assigneeId ? await deps.staff.member(ctx, input.assigneeId) : null;

    if (input.assigneeId && !assignee) throw invalid("That person isn't on this tenant's staff");

    await deps.uow.run(ctx, async (tx) => {
      const referral = await loadReferral(deps, tx, ctx, input.id);

      referral.assign(
        assignee && { id: assignee.userId, name: assignee.name },
        personOf(ctx, input.actorName),
        clockOf(deps, ctx),
      );

      await persist(deps, tx, referral);
    });
  };
}

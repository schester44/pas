import { DomainError, type TenantContext } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { type TransactionDto, toTransactionDto } from "./dto";
import { billIssued, type ChangeDeps, loadPolicy, today } from "./pricing";

/** Cure: withdraws the pending cancellation with a premium-neutral CANCELLATION_RESCISSION. */
export function makeRescindCancellation(deps: ChangeDeps) {
  return async function rescindCancellation(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string; note?: string; actor: TimelineActor; canIssue: boolean },
  ): Promise<TransactionDto> {
    if (!input.canIssue)
      throw new DomainError("forbidden", "Only someone who can issue may rescind a cancellation");

    return deps.uow.run(ctx, async (tx) => {
      const policy = await loadPolicy(deps, ctx, scope, input.policyId, tx);

      const rescission = policy.rescindCancellation(
        policy.currentTerm.id,
        {
          actor: input.actor,
          today: today(deps.clocks.forTenant(ctx.tenantId)),
          ...(input.note && { note: input.note }),
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await billIssued(deps, tx, ctx, policy, rescission.id, [], input.actor);
      await deps.policies.save(tx, policy);
      await deps.outbox.add(tx, policy.pullEvents());

      return toTransactionDto(rescission);
    });
  };
}

export type RescindCancellation = ReturnType<typeof makeRescindCancellation>;

import { parsePlainDate, type TenantContext } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { type CancellationDeps, commitCancellation } from "./commit-cancellation";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type Authority, loadPolicy, priceCancellation } from "./pricing";

/**
 * Initiates a cancellation. With authority it schedules at once (notice, pending_cancellation);
 * otherwise it waits for approval by someone who can issue (PLAN §7.4).
 */
export function makeInitiateCancellation(deps: CancellationDeps) {
  return async function initiateCancellation(
    ctx: TenantContext,
    scope: PolicyScope,
    input: {
      policyId: string;
      reason: string;
      effectiveDate: string;
      note?: string;
      actor: TimelineActor;
      authority: Authority;
    },
  ): Promise<TransactionDto> {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);

    const pricing = await priceCancellation(deps, ctx, policy, {
      reason: input.reason,
      effectiveDate: parsePlainDate(input.effectiveDate),
      ...(input.note && { note: input.note }),
    });

    if (input.authority.issue) {
      return commitCancellation(deps, ctx, scope, {
        policyId: input.policyId,
        pricing,
        actor: input.actor,
      });
    }

    return deps.uow.run(ctx, async (tx) => {
      const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

      const transaction = current.quoteTransaction(
        {
          termId: current.currentTerm.id,
          type: "CANCELLATION",
          effectiveDate: pricing.effectiveDate,
          details: pricing.details,
          actor: input.actor,
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      current.requestApproval(
        transaction.id,
        [`${pricing.details.cancellation!.reasonLabel} requested by ${input.actor.name}`],
        input.actor,
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.policies.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return toTransactionDto(transaction);
    });
  };
}

export type InitiateCancellation = ReturnType<typeof makeInitiateCancellation>;

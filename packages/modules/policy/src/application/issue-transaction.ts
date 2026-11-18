import { type TenantContext } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { type CancellationDeps, commitCancellation } from "./commit-cancellation";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type Authority, billIssued, loadPolicy, priceCancellation, today } from "./pricing";

/**
 * Issues a quoted transaction, or approves one pending approval (PLAN §7.4). Referrals need
 * underwriting authority and every issue needs `transaction:issue`; without them the transaction
 * goes to pending_approval instead.
 */
export function makeIssueTransaction(deps: CancellationDeps) {
  return async function issueTransaction(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string; transactionId: string; actor: TimelineActor; authority: Authority },
  ): Promise<TransactionDto> {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const transaction = policy.transaction(input.transactionId);

    if (transaction.status === "issued" || transaction.status === "scheduled")
      return toTransactionDto(transaction);

    const referrals = transaction.details?.referrals ?? [];

    const needsApproval =
      !input.authority.issue || (referrals.length > 0 && !input.authority.approveReferrals);

    if (needsApproval) {
      return deps.uow.run(ctx, async (tx) => {
        const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

        const reasons =
          referrals.length > 0 ? referrals.map((r) => r.message) : [`needs someone who can issue`];

        current.requestApproval(
          input.transactionId,
          reasons,
          input.actor,
          deps.clocks.forTenant(ctx.tenantId),
        );

        await deps.policies.save(tx, current);
        await deps.outbox.add(tx, current.pullEvents());

        return toTransactionDto(current.transaction(input.transactionId));
      });
    }

    const approvedBy = transaction.status === "pending_approval" ? input.actor : undefined;

    if (transaction.type === "CANCELLATION") {
      const cancellation = transaction.details!.cancellation!;

      const pricing = await priceCancellation(deps, ctx, policy, {
        reason: cancellation.reason,
        effectiveDate: transaction.effectiveDate,
        ...(transaction.details?.note && { note: transaction.details.note }),
      });

      return commitCancellation(deps, ctx, scope, {
        policyId: input.policyId,
        pricing,
        transactionId: transaction.id,
        actor: input.actor,
        ...(approvedBy && { approvedBy }),
      });
    }

    return deps.uow.run(ctx, async (tx) => {
      const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

      const charges = current.issueTransaction(
        input.transactionId,
        today(deps.clocks.forTenant(ctx.tenantId)),
        deps.clocks.forTenant(ctx.tenantId),
        approvedBy,
      );

      await billIssued(deps, tx, ctx, current, input.transactionId, charges, input.actor);
      await deps.policies.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return toTransactionDto(current.transaction(input.transactionId));
    });
  };
}

export type IssueTransaction = ReturnType<typeof makeIssueTransaction>;

export function makeDiscardTransaction(
  deps: Pick<CancellationDeps, "uow" | "outbox" | "policies" | "clocks">,
) {
  return async function discardTransaction(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string; transactionId: string; actor: TimelineActor; note?: string },
  ): Promise<void> {
    await deps.uow.run(ctx, async (tx) => {
      const policy = await loadPolicy(deps, ctx, scope, input.policyId, tx);

      policy.discardTransaction(
        input.transactionId,
        input.actor,
        deps.clocks.forTenant(ctx.tenantId),
        input.note,
      );

      await deps.policies.save(tx, policy);
      await deps.outbox.add(tx, policy.pullEvents());
    });
  };
}

export type DiscardTransaction = ReturnType<typeof makeDiscardTransaction>;

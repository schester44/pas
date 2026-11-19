import { type CarrierOutcome, carrierAssignmentOf } from "@pas/carriers";
import type { TenantContext } from "@pas/kernel";
import type { PolicyScope } from "../domain/scope";
import { type CancellationDeps } from "./commit-cancellation";
import { makeIssueTransaction } from "./issue-transaction";
import { loadPolicy } from "./pricing";

const STAFF: PolicyScope = { kind: "tenant" };

/**
 * Applies the carrier's answer to a delegated change (PLAN §12): confirmed → issued with the
 * carrier's figures when they win; refused or failed → back to quoted with its reason.
 */
export function makeCompleteCarrierTransaction(deps: CancellationDeps) {
  const issueTransaction = makeIssueTransaction(deps);

  return async function completeCarrierTransaction(
    ctx: TenantContext,
    input: {
      policyId: string;
      transactionId: string;
      flowRunId: string;
      outcome: CarrierOutcome;
      error: string | null;
    },
  ): Promise<{ status: string }> {
    const policy = await loadPolicy(deps, ctx, STAFF, input.policyId);
    const transaction = policy.transaction(input.transactionId);

    if (
      transaction.status !== "pending_carrier" ||
      transaction.details?.carrier?.flowRunId !== input.flowRunId
    ) {
      return { status: "stale" };
    }

    const confirmed = !["failed", "declined", "referred"].includes(input.outcome.status);
    const actor = { type: "system" as const, name: transaction.details.carrier.name };

    if (!confirmed) {
      const reason =
        input.outcome.messages.map((m) => m.text).join("; ") || input.error || "No reason given";

      await deps.uow.run(ctx, async (tx) => {
        const current = await loadPolicy(deps, ctx, STAFF, input.policyId, tx);

        current.rejectByCarrier(input.transactionId, reason, deps.clocks.forTenant(ctx.tenantId));
        await deps.policies.save(tx, current);
        await deps.outbox.add(tx, current.pullEvents());
      });

      return { status: "rejected" };
    }

    const release = await deps.config.release(ctx, policy.currentTerm.productReleaseId);
    const figuresWin = carrierAssignmentOf(release.lifecycle)?.ownership.lineItems === "carrier";

    const issued = await issueTransaction(ctx, STAFF, {
      policyId: input.policyId,
      transactionId: input.transactionId,
      actor,
      authority: { issue: true, approveReferrals: true },
      carrier: { outcome: input.outcome, figuresWin },
    });

    return { status: issued.status };
  };
}

export type CompleteCarrierTransaction = ReturnType<typeof makeCompleteCarrierTransaction>;

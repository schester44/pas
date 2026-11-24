import type { CarrierOutcome } from "@pas/carriers";
import { type TenantContext } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { TransactionDetails } from "../domain/transaction";
import type { PolicyScope } from "../domain/scope";
import { type CancellationDeps, commitCancellation } from "./commit-cancellation";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type Authority, billIssued, loadPolicy, priceCancellation, today } from "./pricing";
import { carrierChargesFor, carrierOwning, delegateToCarrier } from "./carrier-delegation";

/** The carrier's answer to a delegated change, applied when issuing (PLAN §12). */
export interface CarrierConfirmation {
  outcome: CarrierOutcome;
  figuresWin: boolean;
}

/**
 * Issues a quoted transaction, or approves one pending approval (PLAN §7.4). Referrals need
 * underwriting authority and every issue needs `transaction:issue`; without them the transaction
 * goes to pending_approval instead.
 */
export function makeIssueTransaction(deps: CancellationDeps) {
  return async function issueTransaction(
    ctx: TenantContext,
    scope: PolicyScope,
    input: {
      policyId: string;
      transactionId: string;
      actor: TimelineActor;
      authority: Authority;
      carrier?: CarrierConfirmation;
    },
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

    if (transaction.status === "pending_carrier" && !input.carrier)
      return toTransactionDto(transaction);

    const owner = input.carrier ? null : await carrierOwning(deps, ctx, policy, transaction.type);

    if (owner) {
      return delegateToCarrier(deps, ctx, scope, {
        policyId: input.policyId,
        transactionId: transaction.id,
        actor: input.actor,
        carrier: owner.carrier,
        capability: owner.capability,
      });
    }

    const approvedBy = transaction.status === "pending_approval" ? input.actor : undefined;

    if (transaction.type === "CANCELLATION") {
      const cancellation = transaction.details!.cancellation!;

      const priced = await priceCancellation(deps, ctx, policy, {
        reason: cancellation.reason,
        effectiveDate: transaction.effectiveDate,
        transactionId: transaction.id,
        ...(transaction.details?.note && { note: transaction.details.note }),
        charges: (transaction.details?.retained ?? []).flatMap((line) =>
          line.code
            ? [{ code: line.code, description: line.name, amount: line.amount.toString() }]
            : [],
        ),
      });

      const pricing = input.carrier
        ? {
            ...priced,
            details: confirmedDetails(
              priced.details,
              transaction.details!,
              input.carrier,
              policy.currentTerm.writtenPremium.currency,
            ),
          }
        : priced;

      if (input.carrier) {
        await deps.uow.run(ctx, async (tx) => {
          const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

          current.confirmByCarrier(
            input.transactionId,
            pricing.details,
            deps.clocks.forTenant(ctx.tenantId),
          );

          await deps.policies.save(tx, current);
        });
      }

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

      if (input.carrier) {
        const held = current.transaction(input.transactionId);
        const currency = current.term(held.termId).writtenPremium.currency;

        current.confirmByCarrier(
          input.transactionId,
          confirmedDetails(held.details!, held.details!, input.carrier, currency),
          deps.clocks.forTenant(ctx.tenantId),
        );
      }

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

function confirmedDetails(
  details: TransactionDetails,
  held: TransactionDetails,
  confirmation: CarrierConfirmation,
  currency: string,
): TransactionDetails {
  const handling = held.carrier && {
    ...held.carrier,
    ...(confirmation.outcome.reference && { reference: confirmation.outcome.reference }),
  };

  const replaced = confirmation.figuresWin
    ? carrierChargesFor(details, confirmation.outcome, currency)
    : null;

  return {
    ...(replaced?.details ?? details),
    ...(handling && { carrier: { ...handling, ...(replaced && { diff: replaced.diff }) } }),
  };
}

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

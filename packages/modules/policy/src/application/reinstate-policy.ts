import { DomainError, parsePlainDate, type TenantContext } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { type TransactionDto, toTransactionDto } from "./dto";
import {
  type Authority,
  billIssued,
  type ChangeDeps,
  loadPolicy,
  priceReinstatement,
  today,
} from "./pricing";

const dateOf = (value?: string) => (value ? { effectiveDate: parsePlainDate(value) } : {});

export function makeQuoteReinstatement(
  deps: Pick<ChangeDeps, "uow" | "policies" | "config" | "rater" | "clocks">,
) {
  return async function quoteReinstatement(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string; lapse: boolean; effectiveDate?: string },
  ) {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);

    const pricing = await priceReinstatement(deps, ctx, policy, {
      lapse: input.lapse,
      ...dateOf(input.effectiveDate),
    });

    const term = policy.currentTerm;

    const preview = toTransactionDto({
      id: "",
      termId: term.id,
      type: "REINSTATEMENT",
      status: "quoted",
      effectiveDate: pricing.effectiveDate,
      premiumDelta: pricing.details.premium.reduce(
        (sum, l) => sum.plus(l.amount),
        term.writtenPremium.minus(term.writtenPremium),
      ),
      baseVersion: 0,
      details: pricing.details,
      createdBy: null,
      createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      updatedAt: Temporal.Instant.fromEpochMilliseconds(0),
      issuedAt: null,
    });

    return {
      effectiveDate: pricing.effectiveDate.toString(),
      cancelledOn: pricing.cancelledOn.toString(),
      windowEnds: pricing.windowEnds.toString(),
      preview,
    };
  };
}

/** Restores coverage after a cancellation, with or without a lapse (PLAN §7.3–7.4). */
export function makeReinstatePolicy(deps: ChangeDeps) {
  return async function reinstatePolicy(
    ctx: TenantContext,
    scope: PolicyScope,
    input: {
      policyId: string;
      lapse: boolean;
      effectiveDate?: string;
      note?: string;
      actor: TimelineActor;
      authority: Authority;
    },
  ): Promise<TransactionDto> {
    if (!input.authority.issue)
      throw new DomainError("forbidden", "Only someone who can issue may reinstate a policy");

    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const base = policy.latestVersion(policy.currentTerm.id).version;

    const pricing = await priceReinstatement(deps, ctx, policy, {
      lapse: input.lapse,
      ...dateOf(input.effectiveDate),
      ...(input.note && { note: input.note }),
    });

    return deps.uow.run(ctx, async (tx) => {
      const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);
      const term = current.currentTerm;

      if (current.latestVersion(term.id).version !== base) {
        throw new DomainError("precondition_failed", "The policy just changed. Try again.");
      }

      const transaction = current.quoteTransaction(
        {
          termId: term.id,
          type: "REINSTATEMENT",
          effectiveDate: pricing.effectiveDate,
          details: pricing.details,
          actor: input.actor,
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      const charges = current.issueTransaction(
        transaction.id,
        today(deps.clocks.forTenant(ctx.tenantId)),
        deps.clocks.forTenant(ctx.tenantId),
      );

      await billIssued(deps, tx, ctx, current, transaction.id, charges, input.actor);
      await deps.policies.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return toTransactionDto(current.transaction(transaction.id));
    });
  };
}

export type QuoteReinstatement = ReturnType<typeof makeQuoteReinstatement>;
export type ReinstatePolicy = ReturnType<typeof makeReinstatePolicy>;

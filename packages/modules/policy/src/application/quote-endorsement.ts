import { DomainError, parsePlainDate, type TenantContext } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import type { CoverageChoice } from "../ports/term-rater";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type PartyChanges, priceEndorsement } from "./price-endorsement";
import { type ChangeDeps, loadPolicy } from "./pricing";

/** Prices a change and stores it as a quoted ENDORSEMENT, ready to issue (PLAN §7.4). */
export function makeQuoteEndorsement(deps: ChangeDeps) {
  return async function quoteEndorsement(
    ctx: TenantContext,
    scope: PolicyScope,
    input: {
      policyId: string;
      transactionId?: string;
      effectiveDate: string;
      risk?: Record<string, unknown>;
      coverages?: CoverageChoice[];
      parties?: PartyChanges;
      note?: string;
      actor: TimelineActor;
      roles?: readonly string[];
    },
  ): Promise<TransactionDto> {
    const effectiveDate = parsePlainDate(input.effectiveDate);
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const term = policy.currentTerm;

    const details = await priceEndorsement(deps, ctx, policy, { ...input, effectiveDate });
    const base = policy.latestVersion(term.id).version;

    return deps.uow.run(ctx, async (tx) => {
      const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

      if (current.latestVersion(term.id).version !== base) {
        throw new DomainError("precondition_failed", "The policy just changed. Preview again.");
      }

      const transaction = current.quoteTransaction(
        {
          termId: term.id,
          type: "ENDORSEMENT",
          ...(input.transactionId && { transactionId: input.transactionId }),
          effectiveDate,
          details: { ...details, ...(input.note && { note: input.note }) },
          actor: input.actor,
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.policies.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return toTransactionDto(transaction);
    });
  };
}

export type QuoteEndorsement = ReturnType<typeof makeQuoteEndorsement>;

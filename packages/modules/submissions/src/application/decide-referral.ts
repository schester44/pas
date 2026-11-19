import type { Outbox, TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import type { Underwriter } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import { NO_MODIFICATIONS, type ReferralModifications } from "../domain/underwriter-terms";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type EvaluationDeps, evaluateQuote } from "./evaluate-quote";
import { JOURNEY_EVENTS, type QuoteJourney } from "./quote-journey";
import { type StaffQuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote } from "./quoting";

export interface ReferralDecisionInput {
  submissionId: string;
  outcome: "approve" | "decline";
  note?: string;
  conditions?: string[];
  modifications?: ReferralModifications;
  declineReasons?: { code: string; message: string }[];
  adverseActionNotice?: string;
  underwriterName: string;
}

type Deps = EvaluationDeps & {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  journey: QuoteJourney;
  clocks: ClockProvider;
};

const isModified = (m: ReferralModifications) => m.coverages.length > 0 || m.adjustment !== null;

/**
 * An underwriter's call on a referred quote; resumes the paused journey (PLAN §11). Approving
 * with modifications re-rates on the pinned release before the producer continues.
 */
export function makeDecideReferral(deps: Deps) {
  return async function decideReferral(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: ReferralDecisionInput,
  ): Promise<StaffQuoteDto> {
    const by: Underwriter = {
      userId: ctx.actor.type === "user" ? ctx.actor.userId : null,
      name: input.underwriterName,
    };

    const note = input.note?.trim() || undefined;
    const modifications = input.modifications ?? NO_MODIFICATIONS;

    const rerated =
      input.outcome === "approve" && isModified(modifications)
        ? await rerate(deps, ctx, scope, input.submissionId, modifications)
        : undefined;

    const { submission, quote } = await deps.uow.run(ctx, async (tx) => {
      const loaded = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      if (input.outcome === "approve") {
        const conditions = (input.conditions ?? []).map((c) => c.trim()).filter(Boolean);

        loaded.quote.approve(
          {
            by,
            ...(note && { note }),
            conditions,
            ...(isModified(modifications) && { modifications }),
          },
          clock,
          rerated,
        );
      } else {
        loaded.quote.decline(
          {
            by,
            ...(note && { note }),
            ...(input.declineReasons?.length && { declineReasons: input.declineReasons }),
            ...(input.adverseActionNotice && { adverseActionNotice: input.adverseActionNotice }),
          },
          clock,
        );
      }

      await deps.quotes.save(tx, loaded.quote);
      await deps.outbox.add(tx, loaded.quote.pullEvents());

      return loaded;
    });

    await deps.journey.signal(ctx, quote, JOURNEY_EVENTS.underwriting, {
      outcome: input.outcome === "approve" ? "approved" : "declined",
    });

    return toQuoteDto(quote, submission, "staff");
  };
}

/** Prices the referred quote on the underwriter's terms without changing it. */
export async function rerate(
  deps: Deps,
  ctx: TenantContext,
  scope: SubmissionScope,
  submissionId: string,
  modifications: ReferralModifications,
) {
  const { submission, quote } = await deps.uow.run(ctx, (tx) =>
    loadQuote(deps, tx, ctx, scope, submissionId),
  );

  const q = quote.toSnapshot();
  const release = await deps.catalog.getRelease(ctx, q.productReleaseId);

  return evaluateQuote(deps, ctx, {
    release,
    risk: q.riskData,
    jurisdiction: submission.toSnapshot().jurisdiction,
    termStart: q.termStart,
    termEnd: q.termEnd,
    selection: q.selection,
    channel: submission.toSnapshot().channel,
    modifications,
  });
}

export type DecideReferral = ReturnType<typeof makeDecideReferral>;

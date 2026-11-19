import type { Outbox, TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import type { CoverageChoice } from "../domain/coverages";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type EvaluationDeps, evaluateQuote } from "./evaluate-quote";
import { JOURNEY_EVENTS, type QuoteJourney } from "./quote-journey";
import { type QuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote, termOf } from "./quoting";

/** Re-runs rules and rating for a new coverage selection (PLAN §7.2.1 step 2). */
export function makeCustomizeQuote(
  deps: EvaluationDeps & {
    uow: UnitOfWork;
    outbox: Outbox;
    submissions: SubmissionRepository;
    quotes: QuoteRepository;
    catalog: ProductCatalog;
    journey: QuoteJourney;
    clocks: ClockProvider;
  },
) {
  return async function customizeQuote(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; selection: CoverageChoice[] },
  ): Promise<QuoteDto> {
    const current = await deps.uow.run(ctx, (tx) =>
      loadQuote(deps, tx, ctx, scope, input.submissionId),
    );

    const q = current.quote.toSnapshot();
    const release = await deps.catalog.getRelease(ctx, q.productReleaseId);
    const { reviewWithin } = termOf(release, q.termStart);

    const { evaluation, selection } = await evaluateQuote(deps, ctx, {
      release,
      risk: q.riskData,
      jurisdiction: current.submission.toSnapshot().jurisdiction,
      termStart: q.termStart,
      termEnd: q.termEnd,
      selection: input.selection,
      channel: current.submission.toSnapshot().channel,
    });

    const updated = await deps.uow.run(ctx, async (tx) => {
      const { submission, quote } = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const producer = submission.toSnapshot().producer;

      quote.requote(
        selection,
        evaluation,
        reviewWithin,
        { type: "user", id: producer.userId, name: producer.name },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.quotes.save(tx, quote);
      await deps.outbox.add(tx, quote.pullEvents());

      return { submission, quote };
    });

    if (updated.quote.status !== "quoted") {
      await deps.journey.signal(ctx, updated.quote, JOURNEY_EVENTS.changed);
    }

    return toQuoteDto(updated.quote, updated.submission, "producer");
  };
}

export type CustomizeQuote = ReturnType<typeof makeCustomizeQuote>;

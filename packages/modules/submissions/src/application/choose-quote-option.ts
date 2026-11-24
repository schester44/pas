import {
  type ClockProvider,
  invalid,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionSummaryDto, submissionNames, toSummaryDto } from "./dto";
import type { EvaluationDeps } from "./evaluate-quote";
import { loadSubmission } from "./intake";
import { evaluateCandidate, quoteFor } from "./quote-candidates";
import type { QuoteJourney } from "./quote-journey";

/**
 * The agent picks one of the submission's quote options (PLAN §6.0). It's re-evaluated now, so
 * the quote reflects today's rules and data, and becomes the submission's one Quote.
 */
export function makeChooseQuoteOption(
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
  return async function chooseQuoteOption(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; productReleaseId: string },
  ): Promise<SubmissionSummaryDto> {
    const draft = await deps.uow.run(ctx, (tx) =>
      loadSubmission(deps.submissions, tx, ctx, scope, input.submissionId),
    );

    const option = draft
      .toSnapshot()
      .options.find((o) => o.productReleaseId === input.productReleaseId);

    if (!option) throw invalid("That isn't one of this submission's quote options");

    const evaluated = await evaluateCandidate(
      deps,
      ctx,
      draft,
      option,
      draft.toSnapshot().riskData,
    );

    const result = await deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.submissionId);

      submission.choose(input.productReleaseId, deps.clocks.forTenant(ctx.tenantId));

      const quote = quoteFor(submission, evaluated, submission.toSnapshot().riskData, deps.clocks);

      await deps.submissions.save(tx, submission);
      await deps.quotes.save(tx, quote);
      await deps.outbox.add(tx, [...submission.pullEvents(), ...quote.pullEvents()]);

      return { submission, quote };
    });

    await deps.journey.start(ctx, result.quote);

    return toSummaryDto(
      result.submission,
      await submissionNames(deps.catalog, ctx, result.submission),
      result.quote,
    );
  };
}

export type ChooseQuoteOption = ReturnType<typeof makeChooseQuoteOption>;

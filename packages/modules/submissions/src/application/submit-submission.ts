import { validateSubmission } from "@pas/forms-core";
import type { Clock, Outbox, TenantContext, UnitOfWork } from "@pas/kernel";
import { Quote } from "../domain/quote";
import type { RiskData } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionSummaryDto, toSummaryDto } from "./dto";
import { type EvaluationDeps, evaluateQuote } from "./evaluate-quote";
import { loadSubmission, pinnedIntake } from "./intake";
import type { QuoteJourney } from "./quote-journey";
import { termOf } from "./quoting";

export type SubmitSubmissionResult =
  | { ok: true; submission: SubmissionSummaryDto; quote: { id: string; status: string } }
  | { ok: false; errors: Record<string, string[]> };

/** Validates the intake, then quotes it synchronously: rules, rating, taxes and fees (PLAN §7.2.1). */
export function makeSubmitSubmission(
  deps: EvaluationDeps & {
    uow: UnitOfWork;
    outbox: Outbox;
    submissions: SubmissionRepository;
    quotes: QuoteRepository;
    catalog: ProductCatalog;
    journey: QuoteJourney;
    clock: Clock;
  },
) {
  return async function submitSubmission(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { id: string; riskData: RiskData },
  ): Promise<SubmitSubmissionResult> {
    const draft = await deps.uow.run(ctx, (tx) =>
      loadSubmission(deps.submissions, tx, ctx, scope, input.id),
    );

    const d = draft.toSnapshot();

    const [productName, intake, release] = await Promise.all([
      deps.catalog.productName(ctx, d.productId),
      pinnedIntake(deps.catalog, ctx, draft),
      deps.catalog.getRelease(ctx, d.productReleaseId),
    ]);

    const result = validateSubmission(intake.riskSchema, intake.form, input.riskData);

    if (!result.ok) {
      await deps.uow.run(ctx, async (tx) => {
        const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
        submission.saveDraft(input.riskData, deps.clock);
        await deps.submissions.save(tx, submission);
      });

      return { ok: false, errors: result.errors };
    }

    const { terms, termStart, termEnd, reviewWithin } = termOf(release, d.effectiveDate);

    const { evaluation, selection } = await evaluateQuote(deps, ctx, {
      release,
      risk: result.data,
      jurisdiction: d.jurisdiction,
      termStart,
      termEnd,
      selection: null,
    });

    const quote = await deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
      submission.submit(result.data, deps.clock);

      const created = Quote.create(
        {
          tenantId: ctx.tenantId,
          submissionId: submission.id,
          submissionNumber: d.number,
          productReleaseId: d.productReleaseId,
          termStart,
          termEnd,
          riskData: result.data,
          selection,
          evaluation,
          timing: {
            expiresAt: deps.clock.now().add({ hours: terms.validityDays * 24 }),
            reviewWithin,
          },
          actor: { type: "user", id: d.producer.userId, name: d.producer.name },
        },
        deps.clock,
      );

      await deps.submissions.save(tx, submission);
      await deps.quotes.save(tx, created);
      await deps.outbox.add(tx, [...submission.pullEvents(), ...created.pullEvents()]);

      return { created, summary: toSummaryDto(submission, productName) };
    });

    await deps.journey.start(ctx, quote.created);

    return {
      ok: true,
      submission: quote.summary,
      quote: { id: quote.created.id, status: quote.created.status },
    };
  };
}

export type SubmitSubmission = ReturnType<typeof makeSubmitSubmission>;

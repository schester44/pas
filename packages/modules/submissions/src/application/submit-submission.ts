import { clearanceModeFrom } from "@pas/addresses";
import { validateSubmission } from "@pas/forms-core";
import type { Outbox, TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import { Quote } from "../domain/quote";
import type { RiskData } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";
import type { AddressRegistry } from "../ports/address-registry";
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
    clocks: ClockProvider;
    addresses: AddressRegistry;
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
        submission.saveDraft(input.riskData, deps.clocks.forTenant(ctx.tenantId));
        await deps.submissions.save(tx, submission);
      });

      return { ok: false, errors: result.errors };
    }

    const stamped = await deps.addresses.stamp(ctx, intake.riskSchema, result.data);
    const locations = stamped.addresses.filter((a) => a.role === "location");

    const clearance = await deps.addresses.clearance(ctx, {
      mode: clearanceModeFrom(release.lifecycle),
      subject: { kind: "submission", id: d.id },
      producerId: d.producer.userId,
      addressIds: locations.map((a) => a.addressId),
    });

    if (clearance.outcome === "block") {
      await deps.uow.run(ctx, async (tx) => {
        const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
        submission.saveDraft(stamped.data, deps.clocks.forTenant(ctx.tenantId));
        await deps.submissions.save(tx, submission);
      });

      const taken = new Set(clearance.conflicts.map((c) => c.addressId));

      return {
        ok: false,
        errors: Object.fromEntries(
          locations
            .filter((a) => taken.has(a.addressId))
            .map(({ path }) => [
              path,
              ["Another producer already has an active submission or policy at this address"],
            ]),
        ),
      };
    }

    const { terms, termStart, termEnd, reviewWithin } = termOf(release, d.effectiveDate);

    const { evaluation, selection } = await evaluateQuote(deps, ctx, {
      release,
      risk: stamped.data,
      jurisdiction: d.jurisdiction,
      termStart,
      termEnd,
      selection: null,
      channel: d.channel,
    });

    const quote = await deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
      submission.submit(stamped.data, deps.clocks.forTenant(ctx.tenantId));

      const created = Quote.create(
        {
          tenantId: ctx.tenantId,
          submissionId: submission.id,
          submissionNumber: d.number,
          productReleaseId: d.productReleaseId,
          termStart,
          termEnd,
          riskData: stamped.data,
          selection,
          evaluation,
          timing: {
            expiresAt: deps.clocks
              .forTenant(ctx.tenantId)
              .now()
              .add({ hours: terms.validityDays * 24 }),
            reviewWithin,
          },
          actor: { type: "user", id: d.producer.userId, name: d.producer.name },
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.submissions.save(tx, submission);
      await deps.quotes.save(tx, created);
      await deps.outbox.add(tx, [...submission.pullEvents(), ...created.pullEvents()]);

      return { created, summary: toSummaryDto(submission, productName) };
    });

    await deps.addresses.track(ctx, {
      subject: { kind: "submission", id: d.id },
      label: d.number,
      productId: d.productId,
      producer: { id: d.producer.userId, name: d.producer.name },
      active: true,
      addresses: stamped.addresses,
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

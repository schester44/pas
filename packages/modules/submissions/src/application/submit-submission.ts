import { clearanceModeFrom } from "@pas/addresses";
import { validateSubmission, withRowIds } from "@pas/forms-core";
import type { Outbox, TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import { deferToEnrichment, enrichedRisk, unfilledTargets } from "../domain/enrichment";
import { optionFrom, pickOption } from "../domain/quote-options";
import type { RiskData } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";
import type { AddressRegistry } from "../ports/address-registry";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionSummaryDto, submissionNames, toSummaryDto } from "./dto";
import type { EvaluationDeps } from "./evaluate-quote";
import { prepareRisk, validateRisk } from "./extension-hooks";
import { noExtensions } from "@pas/extension-points";
import { loadSubmission, pinnedIntake } from "./intake";
import { candidatesOf, evaluateCandidate, quoteFor } from "./quote-candidates";
import type { QuoteJourney } from "./quote-journey";

export type SubmitSubmissionResult =
  | {
      ok: true;
      submission: SubmissionSummaryDto;
      /** Null when the agent has options to compare and choose from (PLAN §6.0). */
      quote: { id: string; status: string } | null;
    }
  | { ok: false; errors: Record<string, string[]> };

/**
 * Validates the intake, then evaluates every candidate release synchronously: rules, rating, taxes
 * and fees (PLAN §6.0, §7.2.1). The offering's selection strategy picks the quote, or leaves the
 * choice to the agent.
 */
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

    const [intake, release] = await Promise.all([
      pinnedIntake(deps.catalog, ctx, draft),
      deps.catalog.getRelease(ctx, d.intakeReleaseId),
    ]);

    const result = validateSubmission(intake.riskSchema, intake.form, input.riskData);
    const errors = deferToEnrichment(result.errors, release.enrichment, input.riskData);
    const deferred = new Set(Object.keys(result.errors).filter((path) => !(path in errors)));

    if (Object.keys(errors).length > 0) {
      await deps.uow.run(ctx, async (tx) => {
        const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
        submission.saveDraft(input.riskData, deps.clocks.forTenant(ctx.tenantId));
        await deps.submissions.save(tx, submission);
      });

      return { ok: false, errors };
    }

    const invoker = deps.extensions ?? noExtensions;

    const hook = {
      release,
      jurisdiction: d.jurisdiction,
      effectiveDate: d.effectiveDate.toString(),
      transaction: "NEW_BUSINESS",
      subject: { type: "submission", id: d.id },
    };

    const prepared = await prepareRisk(invoker, ctx, { ...hook, risk: result.data });
    const revalidated = validateSubmission(intake.riskSchema, intake.form, prepared);

    if (!revalidated.ok) {
      return {
        ok: false,
        errors: Object.fromEntries(
          Object.entries(revalidated.errors).map(([path, messages]) => [
            path,
            messages.map((m) => `After the prepare-risk extension: ${m}`),
          ]),
        ),
      };
    }

    const extensionErrors = await validateRisk(invoker, ctx, { ...hook, risk: revalidated.data });

    if (Object.keys(extensionErrors).length > 0) {
      await deps.uow.run(ctx, async (tx) => {
        const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
        submission.saveDraft(input.riskData, deps.clocks.forTenant(ctx.tenantId));
        await deps.submissions.save(tx, submission);
      });

      return { ok: false, errors: extensionErrors };
    }

    const stamped = await deps.addresses.stamp(
      ctx,
      intake.riskSchema,
      withRowIds(intake.riskSchema, revalidated.data),
    );

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

    const evaluated = await Promise.all(
      candidatesOf(draft).map((candidate) =>
        evaluateCandidate(deps, ctx, draft, candidate, stamped.data),
      ),
    );

    const evaluation = (
      evaluated.find((e) => e.candidate.productReleaseId === d.intakeReleaseId) ?? evaluated[0]!
    ).evaluation;

    const unfilled = unfilledTargets(
      release.enrichment,
      stamped.data,
      enrichedRisk(stamped.data, evaluation.enrichment),
      deferred,
    );

    if (unfilled.length > 0) {
      await deps.uow.run(ctx, async (tx) => {
        const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
        submission.saveDraft(stamped.data, deps.clocks.forTenant(ctx.tenantId));
        await deps.submissions.save(tx, submission);
      });

      return {
        ok: false,
        errors: Object.fromEntries(
          unfilled.map((path) => [path, ["We couldn't get this from property data. Enter it."]]),
        ),
      };
    }

    const options = evaluated.map((e) => optionFrom(e.candidate, e.evaluation));
    const picked = pickOption(options, d.selection ?? "first_eligible");
    const chosen = picked && evaluated[options.indexOf(picked)]!;

    const settled = await deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
      const clock = deps.clocks.forTenant(ctx.tenantId);
      submission.submit(stamped.data, options, clock);

      const created = chosen && quoteFor(submission, chosen, stamped.data, deps.clocks);

      if (chosen) submission.choose(chosen.candidate.productReleaseId, clock);

      await deps.submissions.save(tx, submission);

      if (created) await deps.quotes.save(tx, created);

      await deps.outbox.add(tx, [...submission.pullEvents(), ...(created?.pullEvents() ?? [])]);

      return { submission, created };
    });

    const summary = toSummaryDto(
      settled.submission,
      await submissionNames(deps.catalog, ctx, settled.submission),
      settled.created,
    );

    await deps.addresses.track(ctx, {
      subject: { kind: "submission", id: d.id },
      label: d.number,
      productId: settled.submission.toSnapshot().productId,
      producer: { id: d.producer.userId, name: d.producer.name },
      active: true,
      addresses: stamped.addresses,
    });

    if (settled.created) await deps.journey.start(ctx, settled.created);

    return {
      ok: true,
      submission: summary,
      quote: settled.created && { id: settled.created.id, status: settled.created.status },
    };
  };
}

export type SubmitSubmission = ReturnType<typeof makeSubmitSubmission>;

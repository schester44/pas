import {
  type CarrierOutcome,
  chargeFigures,
  premiumFigures,
  premiumKey,
  reconcileFigures,
} from "@pas/carriers";
import { currencyDecimals } from "@pas/forms-core";
import {
  asId,
  DomainError,
  jurisdictionCode,
  Money,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { CarrierQuoteResult } from "../domain/carrier-quote";
import { payPlanOffers } from "../domain/pay-plan-offers";
import type { Quote } from "../domain/quote";
import type { QuoteEvaluation } from "../domain/quote-evaluation";
import { repriceTaxesAndFees, totalOf, type TaxFeeLine } from "../domain/taxes-fees";
import type { CarrierGateway } from "../ports/carrier-gateway";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { carrierInputFor } from "./carrier-input";
import { JOURNEY_EVENTS, type QuoteJourney } from "./quote-journey";

export interface CarrierQuotingDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  quotes: QuoteRepository;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  carrier: CarrierGateway;
  clocks: ClockProvider;
}

/**
 * Asks the release's carrier for its quote once the quote is priced (PLAN §12). Runs after every
 * journey start or signal; a revision already sent, or one the carrier doesn't rate, is skipped.
 */
export function makeRequestCarrierQuote(deps: CarrierQuotingDeps) {
  return async function requestCarrierQuote(ctx: TenantContext, quote: Quote): Promise<void> {
    const q = quote.toSnapshot();
    const carrier = q.evaluation.carrier;

    if (
      quote.status !== "quoted" ||
      !carrier ||
      carrier.status !== "pending_carrier" ||
      carrier.flowRunId
    )
      return;

    const loaded = await deps.uow.run(ctx, async (tx) => {
      const current = await deps.quotes.findById(tx, ctx, q.id);

      const submission = await deps.submissions.findById(
        tx,
        ctx,
        { kind: "tenant" },
        q.submissionId,
      );

      return current && submission && { current, submission };
    });

    if (!loaded || loaded.current.toSnapshot().revision !== q.revision) return;

    const [release, productName, name] = await Promise.all([
      deps.catalog.getRelease(ctx, q.productReleaseId),
      deps.catalog.productName(ctx, loaded.submission.toSnapshot().productId),
      deps.carrier.carrierName(ctx, carrier.carrier),
    ]);

    let started: { flowRunId: string } | { error: string };

    try {
      started = await deps.carrier.start(ctx, {
        carrier: carrier.carrier,
        capability: "quote",
        subject: {
          kind: "quote",
          quoteId: q.id,
          submissionId: q.submissionId,
          revision: q.revision,
        },
        input: carrierInputFor({
          capability: "quote",
          quote: loaded.current,
          submission: loaded.submission,
          release,
          productName,
        }),
        idempotencyKey: `quote:${q.id}:r${q.revision}`,
      });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;

      started = { error: error.message };
    }

    await deps.uow.run(ctx, async (tx) => {
      const current = await deps.quotes.findById(tx, ctx, q.id);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      if (!current || current.toSnapshot().revision !== q.revision) return;

      if ("flowRunId" in started) {
        current.carrierRequested({ name, flowRunId: started.flowRunId }, clock);
      } else {
        current.carrierRequested({ name, flowRunId: null }, clock);

        current.applyCarrierQuote(
          { status: "failed", reference: null, messages: [{ text: started.error }], diff: null },
          null,
          clock,
        );
      }

      await deps.quotes.save(tx, current);
    });
  };
}

/** The carrier's figures in place of ours, with the diff (PLAN §12 "carrier figures win"). */
export function carrierFigures(
  evaluation: QuoteEvaluation,
  outcome: CarrierOutcome,
  release: Pick<CatalogRelease, "coverages">,
) {
  const premium = outcome.premium;

  if (!premium || premium.lines.length === 0) return null;

  const currency = evaluation.total.currency;
  const names = new Map(release.coverages.map((c) => [c.code, c.name]));
  const label = (line: { coverage: string }) => names.get(line.coverage) ?? line.coverage;

  const ours = [
    ...evaluation.premium.map((l) => ({ key: premiumKey(l), label: label(l), amount: l.premium })),
    ...evaluation.taxesFees.map((l) => ({ key: l.code, label: l.label, amount: l.amount })),
  ];

  const lines = premium.lines.map((line) => ({
    coverage: line.coverage,
    ...(line.exposure !== undefined && { exposure: line.exposure }),
    premium: Money.of(line.amount, currency),
  }));

  const writtenPremium = totalOf(
    lines.map((l) => ({ amount: l.premium })),
    currency,
  );

  const rounding = { mode: "half_up" as const, places: currencyDecimals(currency) };
  const carrierCodes = new Set(premium.taxesFees.map((t) => t.code));

  const taxesFees: TaxFeeLine[] = [
    ...repriceTaxesAndFees(
      evaluation.taxesFees.filter((t) => !carrierCodes.has(t.code)),
      writtenPremium,
      rounding,
    ),
    ...premium.taxesFees.map((t) => ({
      code: t.code,
      label: t.label,
      basis: "flat" as const,
      taxable: false,
      remitter: "carrier" as const,
      amount: Money.of(t.amount, currency),
    })),
  ];

  const theirs = [
    ...premiumFigures(premium.lines, currency, label),
    ...chargeFigures(
      taxesFees.map((t) => ({ code: t.code, label: t.label, amount: t.amount.toString() })),
      currency,
    ),
  ];

  const { diff } = reconcileFigures(ours, theirs, currency);

  return {
    figures: {
      premium: lines,
      writtenPremium,
      taxesFees,
      total: writtenPremium.plus(totalOf(taxesFees, currency)),
    },
    diff,
  };
}

export function makeApplyCarrierQuote(deps: CarrierQuotingDeps & { journey: QuoteJourney }) {
  return async function applyCarrierQuote(
    ctx: TenantContext,
    input: { quoteId: string; revision: number; outcome: CarrierOutcome; error: string | null },
  ): Promise<{ applied: boolean }> {
    const quote = await deps.uow.run(ctx, (tx) =>
      deps.quotes.findById(tx, ctx, asId(input.quoteId)),
    );

    const q = quote?.toSnapshot();

    if (!quote || !q || q.revision !== input.revision || !q.evaluation.carrier)
      return { applied: false };

    const release = await deps.catalog.getRelease(ctx, q.productReleaseId);
    const carrier = q.evaluation.carrier;
    const { outcome } = input;

    const status: CarrierQuoteResult["status"] =
      outcome.status === "quoted" || outcome.status === "confirmed"
        ? "quoted"
        : outcome.status === "referred" || outcome.status === "declined"
          ? outcome.status
          : "failed";

    const reconciled = status === "quoted" ? carrierFigures(q.evaluation, outcome, release) : null;

    const submission = await deps.uow.run(ctx, (tx) =>
      deps.submissions.findById(tx, ctx, { kind: "tenant" }, q.submissionId),
    );

    const s = submission?.toSnapshot();

    const figures =
      reconciled && s
        ? {
            ...reconciled.figures,
            payPlans: payPlanOffers(release.billing, {
              premium: reconciled.figures.writtenPremium,
              taxesFees: reconciled.figures.taxesFees,
              jurisdiction: jurisdictionCode(s.jurisdiction),
              channel: s.channel,
              termStart: q.termStart,
              today: deps.clocks.forTenant(ctx.tenantId).today("UTC"),
            }),
          }
        : null;

    const result: CarrierQuoteResult = {
      status,
      reference: outcome.reference ?? null,
      messages:
        outcome.messages.length > 0 ? outcome.messages : input.error ? [{ text: input.error }] : [],
      diff: reconciled?.diff ?? null,
    };

    const saved = await deps.uow.run(ctx, async (tx) => {
      const current = await deps.quotes.findById(tx, ctx, asId(input.quoteId));

      if (!current || current.toSnapshot().revision !== input.revision) return null;

      current.applyCarrierQuote(
        result,
        carrier.figuresWin ? figures : null,
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.quotes.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return current;
    });

    if (saved) await deps.journey.signal(ctx, saved, JOURNEY_EVENTS.changed, { carrier: status });

    return { applied: saved !== null };
  };
}

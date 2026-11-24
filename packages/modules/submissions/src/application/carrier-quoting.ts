import type { CarrierOutcome } from "@pas/carriers";
import {
  asId,
  DomainError,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { CarrierPrice, CarrierQuoteResult, CarrierQuoteState } from "../domain/carrier-quote";
import type { Quote } from "../domain/quote";
import type { QuoteEvaluation } from "../domain/quote-evaluation";
import type { Submission } from "../domain/submission";
import type { UnderwritingReason } from "../domain/underwriting";
import type { CarrierGateway } from "../ports/carrier-gateway";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { carrierInputFor } from "./carrier-input";
import { type EvaluationDeps, evaluateQuote } from "./evaluate-quote";
import { JOURNEY_EVENTS, type QuoteJourney } from "./quote-journey";
import { termOf } from "./quoting";

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
          { status: "failed", reference: null, messages: [{ text: started.error }], price: null },
          null,
          termOf(release, q.termStart).reviewWithin,
          clock,
        );
      }

      await deps.quotes.save(tx, current);
    });
  };
}

const priceOf = (outcome: CarrierOutcome): CarrierPrice | null =>
  outcome.premium && outcome.premium.lines.length > 0
    ? {
        lines: outcome.premium.lines.map((line) => ({
          coverage: line.coverage,
          ...(line.exposure !== undefined && { exposure: line.exposure }),
          amount: line.amount,
        })),
        taxesFees: outcome.premium.taxesFees.map(({ code, label, amount }) => ({
          code,
          label,
          amount,
        })),
      }
    : null;

function resultOf(
  carrier: CarrierQuoteState,
  outcome: CarrierOutcome,
  error: string | null,
): CarrierQuoteResult {
  const status: CarrierQuoteResult["status"] =
    outcome.status === "quoted" || outcome.status === "confirmed"
      ? "quoted"
      : outcome.status === "referred" || outcome.status === "declined"
        ? outcome.status
        : "failed";

  const price = status === "quoted" ? priceOf(outcome) : null;
  const reference = outcome.reference ?? null;

  if (status === "quoted" && !price && carrier.rating === "carrier") {
    return {
      status: "failed",
      reference,
      messages: [{ text: `${carrier.name} answered without a premium` }],
      price: null,
    };
  }

  return {
    status,
    reference,
    messages: outcome.messages.length > 0 ? outcome.messages : error ? [{ text: error }] : [],
    price,
  };
}

/**
 * The quote re-evaluated on the carrier's answer, so rules that read the premium see the real
 * one. When we rate and the carrier only confirms, a different premium is referred instead.
 */
async function evaluationOnAnswer(
  deps: EvaluationDeps,
  ctx: TenantContext,
  input: {
    quote: Quote;
    submission: Submission;
    release: CatalogRelease;
    answered: CarrierQuoteState;
  },
): Promise<QuoteEvaluation | null> {
  const q = input.quote.toSnapshot();
  const s = input.submission.toSnapshot();

  const evaluate = (carrier: CarrierQuoteState) =>
    evaluateQuote(deps, ctx, {
      release: input.release,
      submissionId: q.submissionId,
      risk: q.riskData,
      jurisdiction: s.jurisdiction,
      termStart: q.termStart,
      termEnd: q.termEnd,
      selection: q.selection,
      channel: s.channel,
      modifications: input.quote.modifications(),
      carrier,
    }).then((output) => output.evaluation);

  const { answered } = input;

  if (answered.rating === "carrier") return evaluate(answered);

  const theirs = await evaluate({ ...answered, lineItems: "carrier" });
  const ours = q.evaluation;
  const agreed = theirs.writtenPremium.equals(ours.writtenPremium);
  const kept = answered.lineItems === "carrier" ? theirs : ours;

  if (agreed) return answered.lineItems === "carrier" ? theirs : null;

  const mismatch: UnderwritingReason = {
    source: "carrier",
    decision: `carrier.${answered.carrier}`,
    rule: "premium_mismatch",
    outcome: "refer",
    reasonCode: "carrier_premium_mismatch",
    message: `${answered.name}'s premium differs from our rating`,
    internalMessage: `${answered.name}: ${theirs.writtenPremium.toString()} ${theirs.writtenPremium.currency}; our rating: ${ours.writtenPremium.toString()} ${ours.writtenPremium.currency}`,
  };

  return { ...kept, reasons: [...kept.reasons, mismatch] };
}

export function makeApplyCarrierQuote(
  deps: CarrierQuotingDeps & EvaluationDeps & { journey: QuoteJourney },
) {
  return async function applyCarrierQuote(
    ctx: TenantContext,
    input: { quoteId: string; revision: number; outcome: CarrierOutcome; error: string | null },
  ): Promise<{ applied: boolean }> {
    const loaded = await deps.uow.run(ctx, async (tx) => {
      const quote = await deps.quotes.findById(tx, ctx, asId(input.quoteId));
      const q = quote?.toSnapshot();

      if (!quote || !q || q.revision !== input.revision || !q.evaluation.carrier) return null;

      const submission = await deps.submissions.findById(
        tx,
        ctx,
        { kind: "tenant" },
        q.submissionId,
      );

      return submission && { quote, submission, carrier: q.evaluation.carrier };
    });

    if (!loaded) return { applied: false };

    const q = loaded.quote.toSnapshot();
    const release = await deps.catalog.getRelease(ctx, q.productReleaseId);
    const result = resultOf(loaded.carrier, input.outcome, input.error);

    const evaluation = result.price
      ? await evaluationOnAnswer(deps, ctx, {
          quote: loaded.quote,
          submission: loaded.submission,
          release,
          answered: { ...loaded.carrier, status: "quoted", price: result.price },
        })
      : null;

    const saved = await deps.uow.run(ctx, async (tx) => {
      const current = await deps.quotes.findById(tx, ctx, asId(input.quoteId));

      if (!current || current.toSnapshot().revision !== input.revision) return null;

      current.applyCarrierQuote(
        result,
        evaluation,
        termOf(release, q.termStart).reviewWithin,
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.quotes.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return current;
    });

    if (saved) {
      await deps.journey.signal(ctx, saved, JOURNEY_EVENTS.changed, { carrier: result.status });
    }

    return { applied: saved !== null };
  };
}

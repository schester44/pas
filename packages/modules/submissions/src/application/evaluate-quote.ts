import { carrierAssignmentOf } from "@pas/carriers";
import { type DecisionKind, type DecisionResult, evaluateDecision } from "@pas/decisions-engine";
import { type BindingInvoker, noExtensions, type RunSubject } from "@pas/extension-points";
import { currencyDecimals } from "@pas/forms-core";
import {
  type ClockProvider,
  DomainError,
  type Jurisdiction,
  jurisdictionCode,
  Money,
  type PlainDate,
  type TenantContext,
  toPlainJson,
} from "@pas/kernel";
import type { CoverageSelection, RatingInput, RatingResult } from "@pas/rating-engine";
import type { Attestation, DiligentSearch } from "../domain/bind-requirements";
import {
  type CarrierPrice,
  type CarrierQuoteState,
  carrierPriceFor,
  pendingCarrierQuote,
} from "../domain/carrier-quote";
import {
  type CoverageChoice,
  coverageOffers,
  defaultSelection,
  normalizeSelection,
} from "../domain/coverages";
import type {
  DecisionRecord,
  PremiumLine,
  QuoteEvaluation,
  RatingRecord,
} from "../domain/quote-evaluation";
import { payPlanOffers } from "../domain/pay-plan-offers";
import { computeTaxesAndFees, type TaxFeeLine, totalOf } from "../domain/taxes-fees";
import { outcomeOf, reasonsFrom, type UnderwritingReason } from "../domain/underwriting";
import {
  adjustPremium,
  insuredValueOf,
  type ReferralModifications,
  withUnderwriterCoverages,
} from "../domain/underwriter-terms";
import type { CatalogRelease, ReleaseDecision } from "../ports/product-catalog";
import type { QuoteRater } from "../ports/quote-rater";
import { noEnrichment, type RiskEnricher } from "../ports/risk-enricher";
import { installmentSplits, underwriteRisk } from "./extension-hooks";

export interface EvaluationDeps {
  rater: QuoteRater;
  enricher: RiskEnricher;
  clocks: ClockProvider;
  extensions?: BindingInvoker;
}

export interface EvaluationInput {
  release: CatalogRelease;
  risk: Record<string, unknown>;
  jurisdiction: Jurisdiction;
  termStart: PlainDate;
  termEnd: PlainDate;
  selection: readonly CoverageChoice[] | null;
  channel?: string;
  transaction?: { type: RatingInput["transaction"]["type"]; effective: PlainDate };
  modifications?: ReferralModifications;
  subject?: RunSubject;
  /** Keeps and reuses enrichment records for this submission. */
  submissionId?: string;
  /** Issued terms are rated on the enrichment pinned at bind, so they pass `false`. */
  enrich?: boolean;
  /** The carrier's answer for this revision; with a price, the quote is priced from it. */
  carrier?: CarrierQuoteState;
}

export interface EvaluationOutput {
  evaluation: QuoteEvaluation;
  selection: CoverageChoice[];
}

/**
 * Auto-evaluation (PLAN §7.2): enrichment → eligibility and underwriting → coverage options →
 * rating → taxes and fees, plus the bind-side decisions. Each decision keeps its trace.
 */
export async function evaluateQuote(
  deps: EvaluationDeps,
  ctx: TenantContext,
  input: EvaluationInput,
): Promise<EvaluationOutput> {
  const started = performance.now();
  const { release } = input;

  const enricher = input.enrich === false ? noEnrichment : deps.enricher;

  const { risk, enrichment } = await enricher.enrich(
    ctx,
    release,
    input.risk,
    ["prefill", "pre_rate"],
    input.submissionId,
  );

  const data = {
    ...risk,
    jurisdiction: input.jurisdiction,
    market: release.market,
    enrichment: {
      derived: enrichment?.derived ?? {},
      discrepancies: enrichment?.discrepancies ?? [],
    },
  };

  const records: DecisionRecord[] = [];

  const run = <K extends DecisionKind>(
    kind: K,
    context: Record<string, unknown> = data,
  ): DecisionResult<K>[] =>
    release.rules
      .filter((rule): rule is ReleaseDecision & { kind: K } => rule.kind === kind)
      .map((rule) => {
        const ref = `${rule.kind}.${rule.key}`;

        const evaluation = evaluateDecision(kind, rule.decision, context, {
          trace: true,
          cacheKey: `${release.id}:${ref}`,
        });

        records.push({
          ref,
          kind,
          name: rule.name,
          result: toPlainJson(evaluation.result),
          ...(evaluation.trace && { trace: toPlainJson(evaluation.trace) }),
          durationMs: evaluation.durationMs,
        });

        return evaluation.result;
      });

  const reasons: UnderwritingReason[] = [
    ...run("eligibility").flatMap((result, index) =>
      reasonsFrom("eligibility", decisionName(release, "eligibility", index), result.outcomes),
    ),
    ...run("underwriting").flatMap((result, index) =>
      reasonsFrom("underwriting", decisionName(release, "underwriting", index), result.outcomes),
    ),
  ];

  const decided = Object.assign({}, ...run("coverage_options").map((r) => r.coverages));
  const offers = coverageOffers(release.coverages, decided);

  const overrides = input.modifications?.coverages ?? [];

  const selection = input.selection
    ? normalizeSelection(offers, withUnderwriterCoverages(input.selection, overrides), risk)
    : defaultSelection(offers, risk);

  const diligentSearch: DiligentSearch | null = run("dea").find((r) => r !== null) ?? null;
  const attestations: Attestation[] = run("attestations").flatMap((r) => r.attestations);

  const declined = outcomeOf(reasons) === "declined";
  const assignment = input.transaction ? null : carrierAssignmentOf(release.lifecycle);
  const carrierPrice = carrierPriceFor(input.carrier);
  const awaitingCarrier = assignment?.ownership.rating === "carrier" && !carrierPrice;

  const priced =
    declined || awaitingCarrier
      ? null
      : await price(deps, ctx, input, risk, selection, {
          taxRules: run("taxes_fees").flatMap((r) => r.lines),
          carrier: carrierPrice,
        });

  const currency = priced?.currency ?? currencyOf(release);
  const insuredValue = insuredValueOf(offers, selection, currency);

  const quoted = {
    ...data,
    quote: {
      tiv: Number(insuredValue.toString()),
      writtenPremium: Number((priced?.writtenPremium ?? Money.zero(currency)).toString()),
    },
  };

  if (priced) {
    reasons.push(
      ...run("referral_triggers", quoted).flatMap((result, index) =>
        result.triggers.map((trigger): UnderwritingReason => ({
          source: "referral_triggers",
          decision: decisionName(release, "referral_triggers", index),
          rule: trigger.code,
          outcome: "refer",
          reasonCode: trigger.code,
          message: trigger.message,
          ...(trigger.authority && { authority: trigger.authority }),
        })),
      ),
    );

    run("subjectivities", quoted);
    run("inspection_requirements", quoted);
  }

  if (!awaitingCarrier)
    reasons.push(
      ...(await underwriteRisk(deps.extensions ?? noExtensions, ctx, {
        release,
        risk,
        jurisdiction: input.jurisdiction,
        effectiveDate: (input.transaction?.effective ?? input.termStart).toString(),
        transaction: input.transaction?.type ?? "NEW_BUSINESS",
        quote: { ...quoted.quote, selection },
        ...(input.subject && { subject: input.subject }),
      })),
    );

  const outcome = outcomeOf(reasons);
  const clock = deps.clocks.forTenant(ctx.tenantId);

  const carrier =
    input.carrier ??
    (!declined && assignment && assignment.ownership.rating !== "pas"
      ? pendingCarrierQuote({
          carrier: assignment.carrier,
          rating: assignment.ownership.rating,
          lineItems: assignment.ownership.lineItems,
        })
      : undefined);

  const offerInput = priced && {
    premium: priced.writtenPremium,
    taxesFees: priced.taxesFees,
    jurisdiction: jurisdictionCode(input.jurisdiction),
    channel: input.channel ?? "",
    termStart: input.termStart,
    today: clock.today("UTC"),
  };

  const standardPlans =
    offerInput && input.channel ? payPlanOffers(release.billing, offerInput) : [];

  const splits =
    offerInput && standardPlans.length > 0
      ? await installmentSplits(deps.extensions ?? noExtensions, ctx, {
          release,
          risk,
          jurisdiction: input.jurisdiction,
          effectiveDate: input.termStart.toString(),
          transaction: input.transaction?.type ?? "NEW_BUSINESS",
          offers: standardPlans,
          plans: release.billing.payPlans,
          premium: offerInput.premium,
          taxesFees: offerInput.taxesFees,
          termStart: input.termStart,
          termEnd: input.termEnd,
          today: offerInput.today,
          ...(input.subject && { subject: input.subject }),
        })
      : new Map();

  const payPlans =
    offerInput && splits.size > 0
      ? payPlanOffers(release.billing, offerInput, splits)
      : standardPlans;

  return {
    selection,
    evaluation: {
      outcome,
      reasons,
      offers,
      premium: priced?.premium ?? [],
      writtenPremium: priced?.writtenPremium ?? Money.zero(currency),
      taxesFees: priced?.taxesFees ?? [],
      total: priced?.total ?? Money.zero(currency),
      rating: priced?.rating ?? null,
      ...(priced?.adjustment && { adjustment: priced.adjustment }),
      decisions: records,
      diligentSearch,
      attestations,
      payPlans,
      ...(carrier && { carrier }),
      ...(enrichment && { enrichment }),
      evaluatedAt: clock.now(),
      durationMs: performance.now() - started,
    },
  };
}

async function price(
  deps: EvaluationDeps,
  ctx: TenantContext,
  input: EvaluationInput,
  risk: Record<string, unknown>,
  selection: CoverageChoice[],
  sources: { taxRules: DecisionResult<"taxes_fees">["lines"]; carrier: CarrierPrice | null },
) {
  const rated = sources.carrier
    ? fromCarrier(sources.carrier, currencyOf(input.release))
    : await rate(deps, ctx, input, risk, selection);

  const { currency } = rated;
  const rounding = { mode: "half_up" as const, places: currencyDecimals(currency) };
  const loading = input.modifications?.adjustment ?? null;
  const adjusted = loading ? adjustPremium(rated.lines, loading.percent, rounding) : null;
  const premium = adjusted?.lines ?? rated.lines;
  const writtenPremium = adjusted ? rated.total.plus(adjusted.amount) : rated.total;
  const theirs = new Set(rated.taxesFees.map((line) => line.code));

  const taxesFees = [
    ...computeTaxesAndFees(sources.taxRules, writtenPremium, rounding).filter(
      (line) => !theirs.has(line.code),
    ),
    ...rated.taxesFees,
  ];

  return {
    currency,
    premium,
    writtenPremium,
    taxesFees,
    total: writtenPremium.plus(totalOf(taxesFees, currency)),
    rating: rated.rating,
    adjustment: adjusted && loading && { ...loading, amount: adjusted.amount },
  };
}

interface Rated {
  currency: string;
  lines: PremiumLine[];
  total: Money;
  taxesFees: TaxFeeLine[];
  rating: RatingRecord | null;
}

async function rate(
  deps: EvaluationDeps,
  ctx: TenantContext,
  input: EvaluationInput,
  risk: Record<string, unknown>,
  selection: CoverageChoice[],
): Promise<Rated> {
  const { release } = input;

  if (!release.rating) {
    throw new DomainError("precondition_failed", "This product has no rater yet", {
      reason: "no_rater",
    });
  }

  const started = performance.now();

  const result: RatingResult = await deps.rater.rate(ctx, {
    releaseId: release.id,
    source: release.rating,
    input: {
      risk,
      coverages: selection.map(toRatingSelection),
      term: { effective: input.termStart.toString(), expiration: input.termEnd.toString() },
      transaction: {
        type: input.transaction?.type ?? "NEW_BUSINESS",
        effective: (input.transaction?.effective ?? input.termStart).toString(),
      },
      jurisdiction: input.jurisdiction,
      currency: currencyOf(release),
    },
  });

  return {
    currency: result.currency,
    lines: result.coverages.map((line) => ({
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      premium: line.premium,
    })),
    total: result.total,
    taxesFees: [],
    rating: {
      artifact: result.artifact,
      worksheet: toPlainJson(result.worksheet),
      factors: toPlainJson(result.factors),
      adjustments: toPlainJson(result.adjustments),
      warnings: result.warnings.map(({ code, message }) => ({ code, message })),
      durationMs: performance.now() - started,
    },
  };
}

/** The carrier's premium lines, and the taxes and fees it charges in place of ours. */
function fromCarrier(price: CarrierPrice, currency: string): Rated {
  const lines = price.lines.map((line) => ({
    coverage: line.coverage,
    ...(line.exposure !== undefined && { exposure: line.exposure }),
    premium: Money.of(line.amount, currency),
  }));

  return {
    currency,
    lines,
    total: totalOf(
      lines.map((line) => ({ amount: line.premium })),
      currency,
    ),
    taxesFees: price.taxesFees.map((line) => ({
      code: line.code,
      label: line.label,
      basis: "flat" as const,
      taxable: false,
      remitter: "carrier" as const,
      amount: Money.of(line.amount, currency),
    })),
    rating: null,
  };
}

function toRatingSelection(choice: CoverageChoice): CoverageSelection {
  const limit = choice.limit?.kind === "money" ? choice.limit.amount : undefined;
  const deductible = choice.deductible;

  const deductibleAmount =
    deductible?.kind === "money"
      ? deductible.amount
      : deductible && limit !== undefined
        ? Money.of(limit).times(deductible.value).dividedBy(100).round(0).toString()
        : undefined;

  return {
    coverage: choice.coverage,
    ...(choice.exposure !== undefined && { exposure: choice.exposure }),
    ...(limit !== undefined && { limit }),
    ...(deductibleAmount !== undefined && { deductible: deductibleAmount }),
    ...(deductible?.kind === "percent" && { options: { deductiblePercent: deductible.value } }),
  };
}

function currencyOf(release: CatalogRelease): string {
  const rating = release.rating;

  if (rating?.engine === "plan") return rating.plan.currency;

  if (rating?.engine === "spreadsheet") return rating.manifest.currency;

  if (rating?.engine === "extension") return rating.currency;

  const money = release.coverages
    .flatMap((coverage) => coverage.limitOptions?.options ?? [])
    .find((option) => option.kind === "money");

  return money?.kind === "money" ? money.currency : "USD";
}

function decisionName(release: CatalogRelease, kind: DecisionKind, index: number): string {
  const rule = release.rules.filter((r) => r.kind === kind)[index];

  return rule ? `${rule.kind}.${rule.key}` : kind;
}

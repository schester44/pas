import { carrierAssignmentOf } from "@pas/carriers";
import { type DecisionKind, type DecisionResult, evaluateDecision } from "@pas/decisions-engine";
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
import { pendingCarrierQuote } from "../domain/carrier-quote";
import {
  type CoverageChoice,
  coverageOffers,
  defaultSelection,
  normalizeSelection,
} from "../domain/coverages";
import type { DecisionRecord, QuoteEvaluation, RatingRecord } from "../domain/quote-evaluation";
import { payPlanOffers } from "../domain/pay-plan-offers";
import { computeTaxesAndFees, totalOf } from "../domain/taxes-fees";
import { outcomeOf, reasonsFrom, type UnderwritingReason } from "../domain/underwriting";
import {
  adjustPremium,
  insuredValueOf,
  type ReferralModifications,
  withUnderwriterCoverages,
} from "../domain/underwriter-terms";
import type { CatalogRelease, ReleaseDecision } from "../ports/product-catalog";
import type { QuoteRater } from "../ports/quote-rater";
import type { RiskEnricher } from "../ports/risk-enricher";

export interface EvaluationDeps {
  rater: QuoteRater;
  enricher: RiskEnricher;
  clocks: ClockProvider;
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
  const { risk } = await deps.enricher.enrich(ctx, release, input.risk, ["prefill", "pre_rate"]);
  const data = { ...risk, jurisdiction: input.jurisdiction, market: release.market };
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

  const priced =
    outcomeOf(reasons) === "declined"
      ? null
      : await price(
          deps,
          ctx,
          input,
          risk,
          selection,
          run("taxes_fees").flatMap((r) => r.lines),
        );

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

  const outcome = outcomeOf(reasons);
  const clock = deps.clocks.forTenant(ctx.tenantId);
  const carrier = priced && !input.transaction ? carrierQuoteFor(release) : undefined;

  const payPlans =
    priced && input.channel
      ? payPlanOffers(release.billing, {
          premium: priced.writtenPremium,
          taxesFees: priced.taxesFees,
          jurisdiction: jurisdictionCode(input.jurisdiction),
          channel: input.channel,
          termStart: input.termStart,
          today: clock.today("UTC"),
        })
      : [];

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
  taxRules: DecisionResult<"taxes_fees">["lines"],
) {
  const { release } = input;

  if (!release.rating) {
    throw new DomainError("precondition_failed", "This product has no rater yet", {
      reason: "no_rater",
    });
  }

  const currency = currencyOf(release);
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
      currency,
    },
  });

  const rating: RatingRecord = {
    artifact: result.artifact,
    worksheet: toPlainJson(result.worksheet),
    factors: toPlainJson(result.factors),
    adjustments: toPlainJson(result.adjustments),
    warnings: result.warnings.map(({ code, message }) => ({ code, message })),
    durationMs: performance.now() - started,
  };

  const rounding = { mode: "half_up" as const, places: currencyDecimals(result.currency) };

  const rated = result.coverages.map((line) => ({
    coverage: line.coverage,
    ...(line.exposure !== undefined && { exposure: line.exposure }),
    premium: line.premium,
  }));

  const loading = input.modifications?.adjustment ?? null;
  const adjusted = loading ? adjustPremium(rated, loading.percent, rounding) : null;
  const premium = adjusted?.lines ?? rated;
  const writtenPremium = adjusted ? result.total.plus(adjusted.amount) : result.total;
  const taxesFees = computeTaxesAndFees(taxRules, writtenPremium, rounding);

  return {
    currency: result.currency,
    premium,
    writtenPremium,
    taxesFees,
    total: writtenPremium.plus(totalOf(taxesFees, result.currency)),
    rating,
    adjustment: adjusted && loading && { ...loading, amount: adjusted.amount },
  };
}

function carrierQuoteFor(release: CatalogRelease) {
  const assignment = carrierAssignmentOf(release.lifecycle);

  if (!assignment || assignment.ownership.rating === "pas") return undefined;

  return pendingCarrierQuote({
    carrier: assignment.carrier,
    rating: assignment.ownership.rating,
    figuresWin:
      assignment.ownership.rating === "carrier" || assignment.ownership.lineItems === "carrier",
  });
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

  const money = release.coverages
    .flatMap((coverage) => coverage.limitOptions?.options ?? [])
    .find((option) => option.kind === "money");

  return money?.kind === "money" ? money.currency : "USD";
}

function decisionName(release: CatalogRelease, kind: DecisionKind, index: number): string {
  const rule = release.rules.filter((r) => r.kind === kind)[index];

  return rule ? `${rule.kind}.${rule.key}` : kind;
}

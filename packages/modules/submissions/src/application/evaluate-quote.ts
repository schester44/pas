import { type DecisionKind, type DecisionResult, evaluateDecision } from "@pas/decisions-engine";
import { currencyDecimals } from "@pas/forms-core";
import {
  DomainError,
  type Jurisdiction,
  jurisdictionCode,
  Money,
  type PlainDate,
  type TenantContext,
  type ClockProvider,
} from "@pas/kernel";
import type { CoverageSelection, RatingInput, RatingResult } from "@pas/rating-engine";
import type { Attestation, DiligentSearch } from "../domain/bind-requirements";
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
}

export interface EvaluationOutput {
  evaluation: QuoteEvaluation;
  selection: CoverageChoice[];
}

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

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

  const run = <K extends DecisionKind>(kind: K): DecisionResult<K>[] =>
    release.rules
      .filter((rule): rule is ReleaseDecision & { kind: K } => rule.kind === kind)
      .map((rule) => {
        const ref = `${rule.kind}.${rule.key}`;

        const evaluation = evaluateDecision(kind, rule.decision, data, {
          trace: true,
          cacheKey: `${release.id}:${ref}`,
        });

        records.push({
          ref,
          kind,
          name: rule.name,
          result: json(evaluation.result),
          ...(evaluation.trace && { trace: json(evaluation.trace) }),
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

  const selection = input.selection
    ? normalizeSelection(offers, input.selection, risk)
    : defaultSelection(offers, risk);

  const diligentSearch: DiligentSearch | null = run("dea").find((r) => r !== null) ?? null;
  const attestations: Attestation[] = run("attestations").flatMap((r) => r.attestations);
  const outcome = outcomeOf(reasons);

  const priced =
    outcome === "declined"
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
  const clock = deps.clocks.forTenant(ctx.tenantId);

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
      decisions: records,
      diligentSearch,
      attestations,
      payPlans,
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
    worksheet: json(result.worksheet),
    factors: json(result.factors),
    adjustments: json(result.adjustments),
    warnings: result.warnings.map(({ code, message }) => ({ code, message })),
    durationMs: performance.now() - started,
  };

  const taxesFees = computeTaxesAndFees(taxRules, result.total, {
    mode: "half_up",
    places: currencyDecimals(result.currency),
  });

  return {
    currency: result.currency,
    premium: result.coverages.map((line) => ({
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      premium: line.premium,
    })),
    writtenPremium: result.total,
    taxesFees,
    total: result.total.plus(totalOf(taxesFees, result.currency)),
    rating,
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

  const money = release.coverages
    .flatMap((coverage) => coverage.limitOptions?.options ?? [])
    .find((option) => option.kind === "money");

  return money?.kind === "money" ? money.currency : "USD";
}

function decisionName(release: CatalogRelease, kind: DecisionKind, index: number): string {
  const rule = release.rules.filter((r) => r.kind === kind)[index];

  return rule ? `${rule.kind}.${rule.key}` : kind;
}

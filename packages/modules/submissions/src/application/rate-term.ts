import { evaluateDecision } from "@pas/decisions-engine";
import { currencyDecimals } from "@pas/forms-core";
import type { Jurisdiction, Money, PlainDate, TenantContext } from "@pas/kernel";
import type { RatingInput } from "@pas/rating-engine";
import type { CoverageChoice } from "../domain/coverages";
import { computeTaxesAndFees } from "../domain/taxes-fees";
import type { ProductCatalog } from "../ports/product-catalog";
import { type EvaluationDeps, evaluateQuote } from "./evaluate-quote";

/**
 * The quoting pipeline (rules, coverage options, rating, taxes) reused for mid-term changes:
 * prices the full term at a new state with the term's pinned release (PLAN §7.4).
 */
export function makeRateTerm(deps: EvaluationDeps & { catalog: ProductCatalog }) {
  return {
    async rate(
      ctx: TenantContext,
      input: {
        productReleaseId: string;
        jurisdiction: Jurisdiction;
        termStart: PlainDate;
        termEnd: PlainDate;
        transaction: { type: RatingInput["transaction"]["type"]; effective: PlainDate };
        risk: Record<string, unknown>;
        coverages: CoverageChoice[];
      },
    ) {
      const release = await deps.catalog.getRelease(ctx, input.productReleaseId);

      const { evaluation, selection } = await evaluateQuote(deps, ctx, {
        release,
        risk: input.risk,
        jurisdiction: input.jurisdiction,
        termStart: input.termStart,
        termEnd: input.termEnd,
        selection: input.coverages,
        transaction: input.transaction,
        enrich: false,
      });

      const names = new Map(release.coverages.map((c) => [c.code, c.name]));

      return {
        outcome: evaluation.outcome,
        reasons: evaluation.reasons.map((r) => ({
          reasonCode: r.reasonCode,
          message: r.message,
          outcome: r.outcome,
          ...(r.authority && { authority: r.authority }),
        })),
        offers: evaluation.offers,
        coverages: evaluation.premium.map((line) => {
          const choice = selection.find(
            (c) => c.coverage === line.coverage && c.exposure === line.exposure,
          );

          return {
            coverage: line.coverage,
            ...(line.exposure !== undefined && { exposure: line.exposure }),
            name: names.get(line.coverage) ?? line.coverage,
            ...(choice?.limit && { limit: choice.limit }),
            ...(choice?.deductible && { deductible: choice.deductible }),
            premium: line.premium,
          };
        }),
        taxesFees: evaluation.taxesFees.map((t) => ({
          code: t.code,
          label: t.label,
          remitter: t.remitter,
          basis: t.basis,
          amount: t.amount,
        })),
        writtenPremium: evaluation.writtenPremium,
        rater: evaluation.rating?.artifact ?? null,
        decisions: evaluation.decisions.map((d) => ({ ref: d.ref, result: d.result })),
      };
    },
    async taxesOn(
      ctx: TenantContext,
      input: {
        productReleaseId: string;
        jurisdiction: Jurisdiction;
        risk: Record<string, unknown>;
        premium: Money;
      },
    ) {
      const release = await deps.catalog.getRelease(ctx, input.productReleaseId);
      const data = { ...input.risk, jurisdiction: input.jurisdiction, market: release.market };

      const rules = release.rules
        .filter((rule) => rule.kind === "taxes_fees")
        .flatMap(
          (rule) =>
            evaluateDecision("taxes_fees", rule.decision, data, {
              cacheKey: `${release.id}:taxes_fees.${rule.key}`,
            }).result.lines,
        );

      return computeTaxesAndFees(rules, input.premium, {
        mode: "half_up",
        places: currencyDecimals(input.premium.currency),
      }).map((t) => ({
        code: t.code,
        label: t.label,
        remitter: t.remitter,
        basis: t.basis,
        amount: t.amount,
      }));
    },
  };
}

export type RateTerm = ReturnType<typeof makeRateTerm>;

import {
  type CircuitBreaker,
  emptySources,
  type EnrichmentCache,
  type EnrichmentPlan,
  type EnrichmentSources,
  type EnrichmentStage,
  isEmptyPlan,
  mappingsOf,
  runEnrichmentStage,
  sourcesOf,
  type TransformRunner,
} from "@pas/enrichment";
import { getAt } from "@pas/forms-core";
import {
  canonicalJson,
  type ClockProvider,
  DomainError,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { createHash } from "node:crypto";
import {
  enrichedRisk,
  type EnrichmentRecord,
  newEnrichmentRecord,
  type QuoteEnrichment,
} from "../domain/enrichment";
import type {
  DataProviders,
  EnrichmentRecordRepository,
  EnrichmentReports,
} from "../ports/enrichment";
import type { CatalogRelease } from "../ports/product-catalog";
import type { RiskEnricher } from "../ports/risk-enricher";

export interface RiskEnricherDeps {
  uow: UnitOfWork;
  records: EnrichmentRecordRepository;
  providers: DataProviders;
  reports: EnrichmentReports;
  cache: EnrichmentCache;
  clocks: ClockProvider;
  breaker?: CircuitBreaker;
  transforms?: { for(ctx: TenantContext): TransformRunner };
}

/**
 * Runs a release's enrichment plan (PLAN §11.1). Each stage's record is kept per submission and
 * reused while the stage's inputs (the risk and earlier stages' sources) are unchanged, so
 * re-evaluating a quote never buys the same data twice and gives the same answer.
 */
export function makeRiskEnricher(deps: RiskEnricherDeps): RiskEnricher {
  return {
    async enrich(ctx, release, risk, stages, submissionId) {
      const plan = release.enrichment;

      if (isEmptyPlan(plan)) return { risk, enrichment: null };

      const userEntered = enteredTargets(plan, risk);
      const records: EnrichmentRecord[] = [];
      let prior = emptySources();
      let current = risk;

      for (const stage of stages) {
        if (!hasWork(plan, stage)) continue;

        const inputHash = hashOf({ release: release.id, stage, risk, prior });

        const reused = submissionId
          ? await deps.uow.run(ctx, (tx) => deps.records.latest(tx, ctx, submissionId, stage))
          : null;

        const record =
          reused?.inputHash === inputHash && reused.productReleaseId === release.id
            ? reused
            : await runStage(
                ctx,
                release,
                stage,
                { risk: current, userEntered, prior, inputHash },
                submissionId,
              );

        if (record.blocked) {
          throw new DomainError(
            "precondition_failed",
            `Data enrichment couldn't finish: ${record.blocked.message}`,
          );
        }

        records.push(record);
        prior = sourcesOf(records.map((r) => r.snapshot));
        current = enrichedRisk(current, { applied: record.prefills });
      }

      return { risk: current, enrichment: summaryOf(records) };
    },
  };

  async function runStage(
    ctx: TenantContext,
    release: CatalogRelease,
    stage: EnrichmentStage,
    input: {
      risk: Record<string, unknown>;
      userEntered: ReadonlySet<string>;
      prior: EnrichmentSources;
      inputHash: string;
    },
    submissionId: string | undefined,
  ): Promise<EnrichmentRecord> {
    const result = await runEnrichmentStage(
      release.enrichment,
      stage,
      { data: input.risk, userEntered: input.userEntered, prior: input.prior },
      {
        tenantId: ctx.tenantId,
        providers: await deps.providers.for(ctx),
        cache: deps.cache,
        clock: deps.clocks.forTenant(ctx.tenantId),
        ...(deps.breaker && { breaker: deps.breaker }),
        ...(deps.transforms && { transforms: deps.transforms.for(ctx) }),
      },
    );

    const reports = submissionId
      ? await deps.reports.keep(ctx, {
          release,
          submissionId,
          result,
          sources: result.sources,
          risk: input.risk,
        })
      : { stored: [], missing: [] };

    const record = newEnrichmentRecord({
      tenantId: ctx.tenantId,
      submissionId: submissionId ?? "",
      productReleaseId: release.id,
      stage,
      inputHash: input.inputHash,
      snapshot: result.snapshot,
      prefills: [...result.prefills],
      discrepancies: [...result.discrepancies],
      calls: [...result.calls],
      reports: reports.stored,
      missingReports: reports.missing,
      blocked: result.blocked ?? null,
      takenAt: result.snapshot.takenAt,
    });

    if (submissionId) await deps.uow.run(ctx, (tx) => deps.records.save(tx, record));

    return record;
  }
}

function hasWork(plan: EnrichmentPlan, stage: EnrichmentStage): boolean {
  return (
    (plan.stages[stage]?.length ?? 0) > 0 ||
    plan.transforms.some((t) => t.stage === stage) ||
    plan.derivations.some((d) => d.stage === stage) ||
    plan.reports.some((r) => r.stage === stage)
  );
}

/** Mapping targets the user filled in; enrichment reports on them but never replaces them. */
function enteredTargets(plan: EnrichmentPlan, risk: Record<string, unknown>): Set<string> {
  return new Set(
    mappingsOf(plan)
      .map((mapping) => mapping.to)
      .filter((path) => {
        const value = getAt(risk, path);

        return value !== undefined && value !== null && value !== "";
      }),
  );
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function summaryOf(records: readonly EnrichmentRecord[]): QuoteEnrichment {
  return {
    recordIds: records.map((r) => r.id),
    applied: records.flatMap((r) => r.prefills),
    discrepancies: records.flatMap((r) => r.discrepancies),
    derived: Object.assign({}, ...records.map((r) => r.snapshot.derived)),
    reports: records.flatMap((r) => r.reports.map((report) => ({ ...report, recordId: r.id }))),
    takenAt: records.at(-1)?.takenAt.toString() ?? null,
  };
}

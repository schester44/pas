import { CAPABILITY_FIELDS, type ProviderCapability } from "@pas/enrichment";
import { canonicalPath, indexSchema, isField, type SchemaNode } from "@pas/forms-core";
import { notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { EnrichmentRecord } from "../domain/enrichment";
import type { SubmissionScope } from "../domain/scope";
import type { EnrichmentRecordRepository, EnrichmentReports } from "../ports/enrichment";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadQuote } from "./quoting";

export interface EnrichmentValueDto {
  key: string;
  label: string;
  kind: string;
  value: unknown;
}

export interface EnrichmentSourceDto {
  callId: string;
  capability: ProviderCapability;
  providerId: string;
  stage: string;
  takenAt: string;
  values: EnrichmentValueDto[];
  tables: {
    key: string;
    label: string;
    columns: EnrichmentValueDto[];
    rows: Record<string, unknown>[];
  }[];
}

export interface QuoteEnrichmentDto {
  /** Risk paths and `derived.*` refs to their labels, from the release's schema and plan. */
  labels: Record<string, string>;
  sources: EnrichmentSourceDto[];
  derived: { key: string; value: unknown }[];
  applied: { path: string; value: unknown; source: string; providerId: string | null }[];
  discrepancies: {
    path: string;
    source: string;
    providerId: string | null;
    userValue: unknown;
    providerValue: unknown;
  }[];
  reports: {
    recordId: string;
    reportId: string;
    title: string;
    source: string;
    providerId: string | null;
  }[];
  missingReports: { reportId: string; title: string; reason: string }[];
  failedCalls: { callId: string; providerId: string | null; outcome: string; error?: string }[];
}

type Deps = {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  records: EnrichmentRecordRepository;
  reports: EnrichmentReports;
  catalog: ProductCatalog;
};

const field = (node: SchemaNode): EnrichmentValueDto => ({
  key: node.key,
  label: node.label,
  kind: node.kind,
  value: null,
});

/** The enrichment a quote used, labelled for the quote screen (PLAN §11.1). */
export function makeGetQuoteEnrichment(deps: Deps) {
  const recordsOf = (ctx: TenantContext, scope: SubmissionScope, submissionId: string) =>
    deps.uow.run(ctx, async (tx) => {
      const { quote } = await loadQuote(deps, tx, ctx, scope, submissionId);
      const q = quote.toSnapshot();
      const ids = q.evaluation.enrichment?.recordIds ?? [];

      const records = await Promise.all(ids.map((id) => deps.records.findById(tx, ctx, id)));

      return {
        releaseId: q.productReleaseId,
        records: records.filter((r): r is EnrichmentRecord => r !== null),
      };
    });

  return {
    async view(
      ctx: TenantContext,
      scope: SubmissionScope,
      input: { submissionId: string },
    ): Promise<QuoteEnrichmentDto | null> {
      const { releaseId, records } = await recordsOf(ctx, scope, input.submissionId);

      if (records.length === 0) return null;

      const release = await deps.catalog.getRelease(ctx, releaseId);
      const index = indexSchema(release.riskSchema);

      const paths = records.flatMap((r) => [
        ...r.prefills.map((p) => p.path),
        ...r.discrepancies.map((d) => d.path),
      ]);

      const labels = Object.fromEntries([
        ...paths.map((path) => [path, index.get(canonicalPath(path))?.label ?? path]),
        ...release.enrichment.derivations.map((d) => [`derived.${d.id}`, d.label ?? d.id]),
      ]);

      return {
        labels,
        sources: records.flatMap((record) =>
          record.snapshot.entries.map((entry) => {
            const nodes = CAPABILITY_FIELDS[entry.capability];

            return {
              callId: entry.callId,
              capability: entry.capability,
              providerId: entry.providerId,
              stage: record.stage,
              takenAt: record.takenAt.toString(),
              values: nodes
                .filter((node) => isField(node) && entry.response[node.key] !== undefined)
                .map((node) => ({ ...field(node), value: entry.response[node.key] })),
              tables: nodes
                .filter(
                  (node) => node.kind === "repeatable" && Array.isArray(entry.response[node.key]),
                )
                .map((node) => ({
                  key: node.key,
                  label: node.label,
                  columns: node.kind === "repeatable" ? node.children.map(field) : [],
                  rows: entry.response[node.key] as Record<string, unknown>[],
                })),
            };
          }),
        ),
        derived: records.flatMap((r) =>
          Object.entries(r.snapshot.derived).map(([key, value]) => ({ key, value })),
        ),
        applied: records.flatMap((r) =>
          r.prefills.map(({ path, value, source, providerId }) => ({
            path,
            value,
            source,
            providerId,
          })),
        ),
        discrepancies: records.flatMap((r) =>
          r.discrepancies.map(({ path, source, providerId, userValue, providerValue }) => ({
            path,
            source,
            providerId,
            userValue,
            providerValue,
          })),
        ),
        reports: records.flatMap((r) =>
          r.reports.map(({ reportId, title, source, providerId }) => ({
            recordId: r.id,
            reportId,
            title,
            source,
            providerId,
          })),
        ),
        missingReports: records.flatMap((r) => r.missingReports),
        failedCalls: records.flatMap((r) => {
          const answered = new Set(r.snapshot.entries.map((e) => e.callId));

          const unanswered = r.calls.filter(
            (c) => !answered.has(c.callId) && c.outcome !== "missing_input",
          );

          return [...new Map(unanswered.map((c) => [c.callId, c])).values()].map(
            ({ callId, providerId, outcome, error }) => ({
              callId,
              providerId,
              outcome,
              ...(error && { error }),
            }),
          );
        }),
      };
    },

    async report(
      ctx: TenantContext,
      scope: SubmissionScope,
      input: { submissionId: string; recordId: string; reportId: string },
    ) {
      const { records } = await recordsOf(ctx, scope, input.submissionId);
      const record = records.find((r) => r.id === input.recordId);
      const report = record?.reports.find((r) => r.reportId === input.reportId);

      if (!report) throw notFound("Report", input.reportId);

      const file = await deps.reports.read(ctx, report);

      if (!file) throw notFound("Report", input.reportId);

      return { title: report.title, contentType: file.contentType, body: file.body };
    },
  };
}

export type GetQuoteEnrichment = ReturnType<typeof makeGetQuoteEnrichment>;

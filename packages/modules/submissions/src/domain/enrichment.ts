import {
  type CallRecord,
  type Discrepancy,
  type EnrichmentSnapshot,
  type EnrichmentStage,
  type Prefill,
  type EnrichmentPlan,
  mappingsOf,
} from "@pas/enrichment";
import { getAt, setAt } from "@pas/forms-core";
import { type Id, type Instant, newId, type TenantId } from "@pas/kernel";

export type EnrichmentRecordId = Id<"EnrichmentRecord">;

export interface StoredReport {
  reportId: string;
  title: string;
  source: "vendor" | "template";
  providerId: string | null;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}

export interface MissingReport {
  reportId: string;
  title: string;
  reason: string;
}

/**
 * One enrichment stage as it ran for a submission (PLAN §11.1): provider responses as returned,
 * transform outputs, derived values, what was applied to the risk and the reports kept. Immutable;
 * a re-run with different inputs appends a new record.
 */
export interface EnrichmentRecord {
  id: EnrichmentRecordId;
  tenantId: TenantId;
  submissionId: string;
  productReleaseId: string;
  stage: EnrichmentStage;
  inputHash: string;
  snapshot: EnrichmentSnapshot;
  prefills: Prefill[];
  discrepancies: Discrepancy[];
  calls: CallRecord[];
  reports: StoredReport[];
  missingReports: MissingReport[];
  blocked: { transformId: string; message: string } | null;
  takenAt: Instant;
}

export function newEnrichmentRecord(props: Omit<EnrichmentRecord, "id">): EnrichmentRecord {
  return { id: newId<"EnrichmentRecord">(), ...props };
}

/** What a quote's evaluation used from enrichment; the records hold the full detail. */
export interface QuoteEnrichment {
  recordIds: string[];
  applied: Prefill[];
  discrepancies: Discrepancy[];
  derived: Record<string, unknown>;
  reports: (StoredReport & { recordId: string })[];
  takenAt: string | null;
}

/** The risk as rated: what the user entered, plus the values enrichment applied. */
export function enrichedRisk(
  risk: Record<string, unknown>,
  enrichment: Pick<QuoteEnrichment, "applied"> | null | undefined,
): Record<string, unknown> {
  return (enrichment?.applied ?? []).reduce(
    (data, prefill) => setAt(data, prefill.path, prefill.value),
    risk,
  );
}

const isBlank = (value: unknown) => value === undefined || value === null || value === "";

/** Risk paths the plan writes to; the user may leave them blank for enrichment to fill. */
export function enrichableTargets(plan: EnrichmentPlan): Set<string> {
  return new Set(
    mappingsOf(plan)
      .filter((m) => m.mode !== "uw_only")
      .map((m) => m.to),
  );
}

/** Drops "required" errors on blank fields enrichment fills; it checks them after it runs. */
export function deferToEnrichment(
  errors: Record<string, string[]>,
  plan: EnrichmentPlan,
  risk: Record<string, unknown>,
): Record<string, string[]> {
  const targets = enrichableTargets(plan);

  return Object.fromEntries(
    Object.entries(errors).filter(([path]) => !(targets.has(path) && isBlank(getAt(risk, path)))),
  );
}

/** Fields enrichment was meant to fill but couldn't, so the user has to enter them. */
export function unfilledTargets(
  plan: EnrichmentPlan,
  entered: Record<string, unknown>,
  rated: Record<string, unknown>,
  required: ReadonlySet<string>,
): string[] {
  return [...enrichableTargets(plan)].filter(
    (path) => required.has(path) && isBlank(getAt(entered, path)) && isBlank(getAt(rated, path)),
  );
}

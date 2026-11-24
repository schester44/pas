import type {
  EnrichmentSources,
  EnrichmentStage,
  EnrichmentStageResult,
  ProviderRegistry,
} from "@pas/enrichment";
import type { TenantContext, Transaction } from "@pas/kernel";
import type { EnrichmentRecord, MissingReport, StoredReport } from "../domain/enrichment";
import type { CatalogRelease } from "./product-catalog";

export interface EnrichmentRecordRepository {
  save(tx: Transaction, record: EnrichmentRecord): Promise<void>;
  latest(
    tx: Transaction,
    ctx: TenantContext,
    submissionId: string,
    stage: EnrichmentStage,
  ): Promise<EnrichmentRecord | null>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<EnrichmentRecord | null>;
  listBySubmission(
    tx: Transaction,
    ctx: TenantContext,
    submissionId: string,
  ): Promise<EnrichmentRecord[]>;
}

/** The tenant's enabled data providers (Integrations), by id. */
export interface DataProviders {
  for(ctx: TenantContext): Promise<ProviderRegistry>;
}

/** Keeps a stage's reports: stores vendor PDFs and renders template reports from the data. */
export interface EnrichmentReports {
  keep(
    ctx: TenantContext,
    input: {
      release: CatalogRelease;
      submissionId: string;
      result: EnrichmentStageResult;
      sources: EnrichmentSources;
      risk: Record<string, unknown>;
    },
  ): Promise<{ stored: StoredReport[]; missing: MissingReport[] }>;
  read(
    ctx: TenantContext,
    report: StoredReport,
  ): Promise<{ body: Uint8Array; contentType: string } | null>;
}

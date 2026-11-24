import { instantFromDb, instantToDb, jsonToDb, prismaTx } from "@pas/db";
import type { EnrichmentRecord as Row } from "@pas/db/client";
import type { CallRecord, EnrichmentSnapshot, EnrichmentStage } from "@pas/enrichment";
import { asId, Money, type TenantContext, type Transaction } from "@pas/kernel";
import type { EnrichmentRecord } from "../domain/enrichment";
import type { EnrichmentRecordRepository } from "../ports/enrichment";

type Json<T> = Omit<T, "takenAt" | "cost"> & {
  takenAt?: string;
  cost?: { amount: string; currency: string } | null;
};

const toDomain = (row: Row): EnrichmentRecord => {
  const snapshot = row.snapshot as unknown as Json<EnrichmentSnapshot>;

  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    submissionId: row.submissionId,
    productReleaseId: row.productReleaseId,
    stage: row.stage as EnrichmentStage,
    inputHash: row.inputHash,
    snapshot: { ...snapshot, takenAt: Temporal.Instant.from(snapshot.takenAt!) },
    prefills: row.prefills as unknown as EnrichmentRecord["prefills"],
    discrepancies: row.discrepancies as unknown as EnrichmentRecord["discrepancies"],
    calls: (row.calls as unknown as Json<CallRecord>[]).map(({ cost, ...call }) => ({
      ...call,
      cost: cost ? Money.fromJSON(cost as Parameters<typeof Money.fromJSON>[0]) : null,
    })),
    reports: row.reports as unknown as EnrichmentRecord["reports"],
    missingReports: row.missingReports as unknown as EnrichmentRecord["missingReports"],
    blocked: (row.blocked as EnrichmentRecord["blocked"]) ?? null,
    takenAt: instantFromDb(row.takenAt),
  };
};

export class PrismaEnrichmentRecordRepository implements EnrichmentRecordRepository {
  async save(tx: Transaction, record: EnrichmentRecord): Promise<void> {
    await prismaTx(tx).enrichmentRecord.create({
      data: {
        id: record.id,
        tenantId: record.tenantId,
        submissionId: record.submissionId,
        productReleaseId: record.productReleaseId,
        stage: record.stage,
        inputHash: record.inputHash,
        snapshot: jsonToDb(record.snapshot),
        prefills: jsonToDb(record.prefills),
        discrepancies: jsonToDb(record.discrepancies),
        calls: jsonToDb(record.calls),
        reports: jsonToDb(record.reports),
        missingReports: jsonToDb(record.missingReports),
        ...(record.blocked && { blocked: jsonToDb(record.blocked) }),
        takenAt: instantToDb(record.takenAt),
      },
    });
  }

  async latest(
    tx: Transaction,
    ctx: TenantContext,
    submissionId: string,
    stage: EnrichmentStage,
  ): Promise<EnrichmentRecord | null> {
    const row = await prismaTx(tx).enrichmentRecord.findFirst({
      where: { tenantId: ctx.tenantId, submissionId, stage },
      orderBy: { takenAt: "desc" },
    });

    return row ? toDomain(row) : null;
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    id: string,
  ): Promise<EnrichmentRecord | null> {
    const row = await prismaTx(tx).enrichmentRecord.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row ? toDomain(row) : null;
  }

  async listBySubmission(
    tx: Transaction,
    ctx: TenantContext,
    submissionId: string,
  ): Promise<EnrichmentRecord[]> {
    const rows = await prismaTx(tx).enrichmentRecord.findMany({
      where: { tenantId: ctx.tenantId, submissionId },
      orderBy: { takenAt: "asc" },
    });

    return rows.map(toDomain);
  }
}

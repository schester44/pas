import { prismaTx } from "@pas/db";
import type { Prisma, RaterWorkbook as RaterWorkbookRow } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { WorkbookReport } from "@pas/rating-engine";
import { RaterWorkbook, type RaterWorkbookId } from "../domain/rater-workbook";
import type { RaterWorkbookRepository } from "../ports/rater-workbook-repository";

const UUID = /^[0-9a-f-]{36}$/i;

export class PrismaRaterWorkbookRepository implements RaterWorkbookRepository {
  async insert(tx: Transaction, workbook: RaterWorkbook): Promise<void> {
    const w = workbook.toSnapshot();

    await prismaTx(tx).raterWorkbook.create({
      data: {
        id: w.id,
        tenantId: w.tenantId,
        name: w.name,
        fileName: w.fileName,
        storageKey: w.file.storageKey,
        contentSha256: w.file.sha256,
        sizeBytes: w.file.sizeBytes,
        report: w.report as unknown as Prisma.InputJsonValue,
        createdBy: w.createdBy,
        createdAt: new Date(w.createdAt.epochMilliseconds),
      },
    });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    id: RaterWorkbookId,
  ): Promise<RaterWorkbook | null> {
    if (!UUID.test(id)) return null;

    const row = await prismaTx(tx).raterWorkbook.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toWorkbook(row) : null;
  }

  async findBySha256(
    tx: Transaction,
    ctx: TenantContext,
    sha256: string,
  ): Promise<RaterWorkbook | null> {
    const row = await prismaTx(tx).raterWorkbook.findFirst({
      where: { tenantId: ctx.tenantId, contentSha256: sha256 },
    });

    return row ? toWorkbook(row) : null;
  }

  async list(tx: Transaction, ctx: TenantContext): Promise<RaterWorkbook[]> {
    const rows = await prismaTx(tx).raterWorkbook.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toWorkbook);
  }
}

function toWorkbook(row: RaterWorkbookRow): RaterWorkbook {
  return RaterWorkbook.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    name: row.name,
    fileName: row.fileName,
    file: { storageKey: row.storageKey, sha256: row.contentSha256, sizeBytes: row.sizeBytes },
    report: row.report as unknown as WorkbookReport,
    createdBy: row.createdBy,
    createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
  });
}

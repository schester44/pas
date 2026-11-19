import {
  instantFromDb,
  instantToDb,
  jsonToDb,
  plainDateFromDb,
  plainDateToDb,
  type Prisma,
  prismaTx,
} from "@pas/db";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { AgencyCode, Enrollment } from "../domain/enrollment";
import type { DownloadBatch, DownloadItem } from "../domain/item";
import type { BatchRepository, EnrollmentRepository, ItemRepository } from "../ports/repositories";

type EnrollmentRow = Prisma.AgencyDownloadEnrollmentGetPayload<object>;
type ItemRow = Prisma.AgencyDownloadItemGetPayload<object>;
type BatchRow = Prisma.AgencyDownloadBatchGetPayload<object>;

const toEnrollment = (r: EnrollmentRow): Enrollment => ({
  id: r.id,
  tenantId: asId(r.tenantId),
  agencyId: r.agencyId,
  accountCode: r.accountCode,
  mailbox: r.mailbox,
  agencyCodes: r.agencyCodes as unknown as AgencyCode[],
  enabled: r.enabled,
  startDate: plainDateFromDb(r.startDate),
  createdAt: instantFromDb(r.createdAt),
  updatedAt: instantFromDb(r.updatedAt),
});

const toItem = (r: ItemRow): DownloadItem => ({
  id: r.id,
  tenantId: asId(r.tenantId),
  agencyId: r.agencyId,
  kind: r.kind as DownloadItem["kind"],
  dedupeKey: r.dedupeKey,
  status: r.status as DownloadItem["status"],
  policyId: r.policyId,
  policyNumber: r.policyNumber,
  transactionId: r.transactionId,
  transactionType: r.transactionType,
  effectiveDate: r.effectiveDate && plainDateFromDb(r.effectiveDate),
  title: r.title,
  record: r.record as unknown as DownloadItem["record"],
  batchId: r.batchId,
  attempts: r.attempts,
  lastError: r.lastError,
  obligationId: r.obligationId,
  createdAt: instantFromDb(r.createdAt),
  deliveredAt: r.deliveredAt && instantFromDb(r.deliveredAt),
});

const toBatch = (r: BatchRow): DownloadBatch => ({
  id: r.id,
  tenantId: asId(r.tenantId),
  agencyId: r.agencyId,
  runKey: r.runKey,
  kind: r.kind as DownloadBatch["kind"],
  trigger: r.trigger as DownloadBatch["trigger"],
  accountCode: r.accountCode,
  mailbox: r.mailbox,
  format: r.format,
  providerId: r.providerId,
  transport: r.transport,
  status: r.status as DownloadBatch["status"],
  fileName: r.fileName,
  fileKey: r.fileKey,
  contentType: r.contentType,
  sizeBytes: r.sizeBytes,
  itemIds: r.itemIds as string[],
  reference: r.reference,
  error: r.error,
  resendOf: r.resendOf,
  createdAt: instantFromDb(r.createdAt),
  deliveredAt: r.deliveredAt && instantFromDb(r.deliveredAt),
});

export class PrismaEnrollmentRepository implements EnrollmentRepository {
  async list(tx: Transaction, ctx: TenantContext): Promise<Enrollment[]> {
    const rows = await prismaTx(tx).agencyDownloadEnrollment.findMany({
      where: { tenantId: ctx.tenantId },
    });

    return rows.map(toEnrollment);
  }

  async findByAgency(tx: Transaction, ctx: TenantContext, agencyId: string) {
    const row = await prismaTx(tx).agencyDownloadEnrollment.findUnique({
      where: { tenantId_agencyId: { tenantId: ctx.tenantId, agencyId } },
    });

    return row && toEnrollment(row);
  }

  async save(tx: Transaction, e: Enrollment): Promise<void> {
    const values = {
      accountCode: e.accountCode,
      mailbox: e.mailbox,
      agencyCodes: jsonToDb(e.agencyCodes),
      enabled: e.enabled,
      startDate: plainDateToDb(e.startDate),
      updatedAt: instantToDb(e.updatedAt),
    };

    await prismaTx(tx).agencyDownloadEnrollment.upsert({
      where: { id: e.id },
      update: values,
      create: {
        ...values,
        id: e.id,
        tenantId: e.tenantId,
        agencyId: e.agencyId,
        createdAt: instantToDb(e.createdAt),
      },
    });
  }
}

export class PrismaItemRepository implements ItemRepository {
  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).agencyDownloadItem.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toItem(row);
  }

  async findByDedupeKey(tx: Transaction, ctx: TenantContext, key: string) {
    const row = await prismaTx(tx).agencyDownloadItem.findUnique({
      where: { tenantId_dedupeKey: { tenantId: ctx.tenantId, dedupeKey: key } },
    });

    return row && toItem(row);
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: Parameters<ItemRepository["list"]>[2],
  ): Promise<DownloadItem[]> {
    const rows = await prismaTx(tx).agencyDownloadItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.status && { status: filter.status }),
        ...(filter.agencyId && { agencyId: filter.agencyId }),
        ...(filter.batchId && { batchId: filter.batchId }),
        ...(filter.policyId && { policyId: filter.policyId }),
        ...(filter.ids && { id: { in: [...filter.ids] } }),
      },
      orderBy: { createdAt: "desc" },
      ...(filter.limit && { take: filter.limit }),
    });

    return rows.map(toItem);
  }

  async save(tx: Transaction, i: DownloadItem): Promise<void> {
    const values = {
      status: i.status,
      title: i.title,
      record: jsonToDb(i.record),
      batchId: i.batchId,
      attempts: i.attempts,
      lastError: i.lastError,
      obligationId: i.obligationId,
      deliveredAt: i.deliveredAt && instantToDb(i.deliveredAt),
    };

    await prismaTx(tx).agencyDownloadItem.upsert({
      where: { id: i.id },
      update: values,
      create: {
        ...values,
        id: i.id,
        tenantId: i.tenantId,
        agencyId: i.agencyId,
        kind: i.kind,
        dedupeKey: i.dedupeKey,
        policyId: i.policyId,
        policyNumber: i.policyNumber,
        transactionId: i.transactionId,
        transactionType: i.transactionType,
        effectiveDate: i.effectiveDate && plainDateToDb(i.effectiveDate),
        createdAt: instantToDb(i.createdAt),
      },
    });
  }
}

export class PrismaBatchRepository implements BatchRepository {
  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).agencyDownloadBatch.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toBatch(row);
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: Parameters<BatchRepository["list"]>[2],
  ): Promise<DownloadBatch[]> {
    const rows = await prismaTx(tx).agencyDownloadBatch.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.agencyId && { agencyId: filter.agencyId }),
        ...(filter.runKeyPrefix && { runKey: { startsWith: filter.runKeyPrefix } }),
      },
      orderBy: { createdAt: "desc" },
      ...(filter.limit && { take: filter.limit }),
    });

    return rows.map(toBatch);
  }

  async save(tx: Transaction, b: DownloadBatch): Promise<void> {
    await prismaTx(tx).agencyDownloadBatch.create({
      data: {
        id: b.id,
        tenantId: b.tenantId,
        agencyId: b.agencyId,
        runKey: b.runKey,
        kind: b.kind,
        trigger: b.trigger,
        accountCode: b.accountCode,
        mailbox: b.mailbox,
        format: b.format,
        providerId: b.providerId,
        transport: b.transport,
        status: b.status,
        fileName: b.fileName,
        fileKey: b.fileKey,
        contentType: b.contentType,
        sizeBytes: b.sizeBytes,
        itemIds: jsonToDb(b.itemIds),
        itemCount: b.itemIds.length,
        reference: b.reference,
        error: b.error,
        resendOf: b.resendOf,
        createdAt: instantToDb(b.createdAt),
        deliveredAt: b.deliveredAt && instantToDb(b.deliveredAt),
      },
    });
  }
}

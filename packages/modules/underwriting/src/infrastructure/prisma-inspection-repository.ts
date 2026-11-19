import { prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { Inspection, type InspectionId, type InspectionProps } from "../domain/inspection";
import type { InspectionRepository } from "../ports/repositories";
import { fromDb, json, revive, toDb } from "./json";

type Row = Prisma.UnderwritingInspectionGetPayload<object>;

function toDomain(row: Row): Inspection {
  return Inspection.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    quoteId: row.quoteId,
    submissionId: row.submissionId,
    submissionNumber: row.submissionNumber,
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    subjectivityId: row.subjectivityId,
    code: row.code,
    type: row.type as InspectionProps["type"],
    timing: row.timing as InspectionProps["timing"],
    reason: row.reason,
    address: row.address as unknown as InspectionProps["address"],
    providerId: row.providerId,
    providerRef: row.providerRef,
    status: row.status as InspectionProps["status"],
    scheduledFor: row.scheduledFor && fromDb(row.scheduledFor),
    completedAt: row.completedAt && fromDb(row.completedAt),
    report: row.report as unknown as InspectionProps["report"],
    review: row.review ? revive(row.review, ["at"]) : null,
    history: (row.history as unknown[]).map((h) => revive(h, ["at"])),
    createdAt: fromDb(row.createdAt),
    updatedAt: fromDb(row.updatedAt),
  });
}

export class PrismaInspectionRepository implements InspectionRepository {
  async save(tx: Transaction, inspection: Inspection): Promise<void> {
    const s = inspection.toSnapshot();

    const fields = {
      policyId: s.policyId,
      policyNumber: s.policyNumber,
      providerId: s.providerId,
      providerRef: s.providerRef,
      status: s.status,
      scheduledFor: s.scheduledFor && toDb(s.scheduledFor),
      completedAt: s.completedAt && toDb(s.completedAt),
      report: s.report ? json(s.report) : undefined,
      review: s.review ? json(s.review) : undefined,
      history: json(s.history),
      updatedAt: toDb(s.updatedAt),
    };

    await prismaTx(tx).underwritingInspection.upsert({
      where: { id: s.id },
      update: fields,
      create: {
        ...fields,
        id: s.id,
        tenantId: s.tenantId,
        quoteId: s.quoteId,
        submissionId: s.submissionId,
        submissionNumber: s.submissionNumber,
        subjectivityId: s.subjectivityId,
        code: s.code,
        type: s.type,
        timing: s.timing,
        reason: s.reason,
        address: json(s.address),
        createdAt: toDb(s.createdAt),
      },
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: InspectionId) {
    const row = await prismaTx(tx).underwritingInspection.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toDomain(row);
  }

  async listByQuote(tx: Transaction, ctx: TenantContext, quoteId: string) {
    const rows = await prismaTx(tx).underwritingInspection.findMany({
      where: { tenantId: ctx.tenantId, quoteId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  async listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string) {
    const rows = await prismaTx(tx).underwritingInspection.findMany({
      where: { tenantId: ctx.tenantId, policyId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { statuses?: readonly string[]; limit?: number },
  ) {
    const rows = await prismaTx(tx).underwritingInspection.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.statuses && { status: { in: [...filter.statuses] } }),
      },
      orderBy: { updatedAt: "desc" },
      take: filter.limit ?? 200,
    });

    return rows.map(toDomain);
  }
}

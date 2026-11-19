import {
  instantFromDb,
  instantToDb,
  jsonToDb,
  plainDateFromDb,
  plainDateToDb,
  prismaTx,
} from "@pas/db";
import type { Prisma } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { Subjectivity, type SubjectivityId, type SubjectivityProps } from "../domain/subjectivity";
import type { SubjectivityRepository } from "../ports/repositories";
import { revive } from "./json";

type Row = Prisma.UnderwritingSubjectivityGetPayload<object>;

function toDomain(row: Row): Subjectivity {
  return Subjectivity.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    quoteId: row.quoteId,
    submissionId: row.submissionId,
    submissionNumber: row.submissionNumber,
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    referralId: row.referralId,
    inspectionId: row.inspectionId,
    code: row.code,
    title: row.title,
    description: row.description,
    timing: row.timing as SubjectivityProps["timing"],
    dueDays: row.dueDays,
    dueDate: row.dueDate && plainDateFromDb(row.dueDate),
    owner: row.owner as SubjectivityProps["owner"],
    source: row.source as SubjectivityProps["source"],
    consequence: row.consequence,
    status: row.status as SubjectivityProps["status"],
    documents: (row.documents as unknown[]).map((d) => revive(d, ["uploadedAt"])),
    history: (row.history as unknown[]).map((h) => revive(h, ["at"])),
    overdueAt: row.overdueAt && instantFromDb(row.overdueAt),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}

export class PrismaSubjectivityRepository implements SubjectivityRepository {
  async save(tx: Transaction, subjectivity: Subjectivity): Promise<void> {
    const s = subjectivity.toSnapshot();

    const fields = {
      policyId: s.policyId,
      policyNumber: s.policyNumber,
      title: s.title,
      description: s.description,
      timing: s.timing,
      dueDays: s.dueDays,
      dueDate: s.dueDate && plainDateToDb(s.dueDate),
      owner: s.owner,
      consequence: s.consequence,
      status: s.status,
      documents: jsonToDb(s.documents),
      history: jsonToDb(s.history),
      overdueAt: s.overdueAt && instantToDb(s.overdueAt),
      updatedAt: instantToDb(s.updatedAt),
    };

    await prismaTx(tx).underwritingSubjectivity.upsert({
      where: { id: s.id },
      update: fields,
      create: {
        ...fields,
        id: s.id,
        tenantId: s.tenantId,
        quoteId: s.quoteId,
        submissionId: s.submissionId,
        submissionNumber: s.submissionNumber,
        referralId: s.referralId,
        inspectionId: s.inspectionId,
        code: s.code,
        source: s.source,
        createdAt: instantToDb(s.createdAt),
      },
    });
  }

  async remove(tx: Transaction, ctx: TenantContext, id: SubjectivityId): Promise<void> {
    await prismaTx(tx).underwritingSubjectivity.deleteMany({
      where: { tenantId: ctx.tenantId, id },
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: SubjectivityId) {
    const row = await prismaTx(tx).underwritingSubjectivity.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toDomain(row);
  }

  async listByQuote(tx: Transaction, ctx: TenantContext, quoteId: string) {
    const rows = await prismaTx(tx).underwritingSubjectivity.findMany({
      where: { tenantId: ctx.tenantId, quoteId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  async listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string) {
    const rows = await prismaTx(tx).underwritingSubjectivity.findMany({
      where: { tenantId: ctx.tenantId, policyId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  async listOpen(tx: Transaction, ctx: TenantContext, limit: number) {
    const rows = await prismaTx(tx).underwritingSubjectivity.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ["open", "received"] } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: limit,
    });

    return rows.map(toDomain);
  }
}

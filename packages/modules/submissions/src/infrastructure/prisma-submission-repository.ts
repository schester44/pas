import { instantFromDb, instantToDb, plainDateFromDb, plainDateToDb, prismaTx } from "@pas/db";
import type {
  Prisma,
  SubmissionStatus as DbSubmissionStatus,
  Submission as SubmissionRow,
} from "@pas/db/client";
import { asId, type Jurisdiction, type TenantContext, type Transaction } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import {
  type RiskData,
  Submission,
  type SubmissionChannel,
  type SubmissionId,
  type SubmissionStage,
  type SubmissionStatus,
} from "../domain/submission";
import type { SubmissionRepository } from "../ports/submission-repository";

const toDbStatus = (s: SubmissionStatus) => s.toUpperCase() as DbSubmissionStatus;
const fromDbStatus = (s: DbSubmissionStatus) => s.toLowerCase() as SubmissionStatus;

function scoped(ctx: TenantContext, scope: SubmissionScope): Prisma.SubmissionWhereInput {
  switch (scope.kind) {
    case "producer":
      return { tenantId: ctx.tenantId, producerId: scope.producerId };
    case "agencies":
      return { tenantId: ctx.tenantId, agencyId: { in: [...scope.agencyIds] } };
    case "tenant":
      return { tenantId: ctx.tenantId };
  }
}

export class PrismaSubmissionRepository implements SubmissionRepository {
  async save(tx: Transaction, submission: Submission): Promise<void> {
    const s = submission.toSnapshot();

    const data = {
      riskData: s.riskData as Prisma.InputJsonValue,
      insuredName: s.insuredName,
      status: toDbStatus(s.status),
      updatedAt: instantToDb(s.updatedAt),
      submittedAt: s.submittedAt ? instantToDb(s.submittedAt) : null,
      withdrawnAt: s.withdrawnAt ? instantToDb(s.withdrawnAt) : null,
    };

    await prismaTx(tx).submission.upsert({
      where: { id: s.id },
      update: data,
      create: {
        ...data,
        id: s.id,
        tenantId: s.tenantId,
        number: s.number,
        productId: s.productId,
        productReleaseId: s.productReleaseId,
        productVersionId: s.productVersionId,
        productVersion: s.productVersion,
        formKey: s.formKey,
        country: s.jurisdiction.country,
        subdivision: s.jurisdiction.subdivision ?? null,
        effectiveDate: plainDateToDb(s.effectiveDate),
        channel: s.channel,
        stage: s.stage,
        producerId: s.producer.userId,
        producerName: s.producer.name,
        agencyId: s.producer.agencyId,
        createdAt: instantToDb(s.createdAt),
      },
    });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    scope: SubmissionScope,
    id: SubmissionId,
  ): Promise<Submission | null> {
    const row = await prismaTx(tx).submission.findFirst({ where: { ...scoped(ctx, scope), id } });

    return row ? toSubmission(row) : null;
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    scope: SubmissionScope,
    options: { limit: number },
  ): Promise<Submission[]> {
    const rows = await prismaTx(tx).submission.findMany({
      where: scoped(ctx, scope),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: options.limit,
    });

    return rows.map(toSubmission);
  }

  async nextSequence(tx: Transaction, ctx: TenantContext): Promise<number> {
    const [row] = await prismaTx(tx).$queryRaw<{ last_value: number }[]>`
      insert into submission_sequences (tenant_id, last_value) values (${ctx.tenantId}, 1)
      on conflict (tenant_id) do update set last_value = submission_sequences.last_value + 1
      returning last_value`;

    if (!row) throw new Error("Submission sequence returned no row");

    return Number(row.last_value);
  }
}

function toSubmission(row: SubmissionRow): Submission {
  const jurisdiction: Jurisdiction = row.subdivision
    ? { country: row.country, subdivision: row.subdivision }
    : { country: row.country };

  return Submission.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    number: row.number,
    productId: row.productId,
    productReleaseId: row.productReleaseId,
    productVersionId: row.productVersionId,
    productVersion: row.productVersion,
    formKey: row.formKey,
    jurisdiction,
    effectiveDate: plainDateFromDb(row.effectiveDate),
    channel: row.channel as SubmissionChannel,
    stage: row.stage as SubmissionStage,
    producer: { userId: asId(row.producerId), name: row.producerName, agencyId: row.agencyId },
    riskData: row.riskData as RiskData,
    insuredName: row.insuredName,
    status: fromDbStatus(row.status),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
    submittedAt: row.submittedAt ? instantFromDb(row.submittedAt) : null,
    withdrawnAt: row.withdrawnAt ? instantFromDb(row.withdrawnAt) : null,
  });
}

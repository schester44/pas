import { prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import type { ObligationKind } from "@pas/decisions-engine";
import { asId, jurisdiction, type TenantContext, type Transaction } from "@pas/kernel";
import type { DueRule } from "../domain/due-date";
import {
  type FilingRecord,
  Obligation,
  type ObligationEvent,
  type ObligationId,
  type ObligationProps,
  OPEN_STATUSES,
} from "../domain/obligation";
import type {
  FilingBatch,
  ObligationFilter,
  ObligationRepository,
} from "../ports/obligation-repository";

const dateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
const dateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
const instantToDb = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const instantFromDb = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const include = {
  filings: { orderBy: { attempt: "asc" } },
  events: { orderBy: { occurredAt: "asc" } },
} satisfies Prisma.ComplianceObligationInclude;

type Row = Prisma.ComplianceObligationGetPayload<{ include: typeof include }>;

const reviveTimes = <T extends Record<string, unknown>>(
  value: T | null,
  keys: string[],
): T | null =>
  value && {
    ...value,
    ...Object.fromEntries(
      keys.filter((k) => value[k]).map((k) => [k, Temporal.Instant.from(value[k] as string)]),
    ),
  };

function toDomain(row: Row): Obligation {
  const props: ObligationProps = {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    dedupeKey: row.dedupeKey,
    kind: row.kind as ObligationKind,
    code: row.code,
    title: row.title,
    status: row.status as ObligationProps["status"],
    jurisdiction: jurisdiction(
      row.country,
      row.jurisdiction === row.country ? null : row.jurisdiction,
    ),
    subject: row.subject as unknown as ObligationProps["subject"],
    responsible: row.responsible as unknown as ObligationProps["responsible"],
    channel: row.channel as ObligationProps["channel"],
    rule: row.rule as unknown as DueRule,
    timer: row.timer as unknown as ObligationProps["timer"],
    dueDate: dateFromDb(row.dueDate),
    lateFrom: instantFromDb(row.lateFrom),
    escalation: row.escalation,
    data: row.data as Record<string, unknown>,
    source: row.source as unknown as ObligationProps["source"],
    proof: reviveTimes(row.proof as Record<string, unknown> | null, [
      "recordedAt",
    ]) as ObligationProps["proof"],
    waiver: reviveTimes(row.waiver as Record<string, unknown> | null, [
      "waivedAt",
    ]) as ObligationProps["waiver"],
    filings: row.filings.map((f): FilingRecord => ({
      id: f.id,
      attempt: f.attempt,
      providerId: f.providerId,
      delivery: f.delivery as FilingRecord["delivery"],
      reference: f.reference,
      batchId: f.batchId,
      status: f.status as FilingRecord["status"],
      filingNumber: f.filingNumber,
      stampNumber: f.stampNumber,
      reasons: f.reasons as string[],
      submittedAt: instantFromDb(f.submittedAt),
      respondedAt: f.respondedAt && instantFromDb(f.respondedAt),
    })),
    events: row.events.map((e): ObligationEvent => ({
      id: e.id,
      type: e.type as ObligationEvent["type"],
      occurredAt: instantFromDb(e.occurredAt),
      actor: e.actor as unknown as ObligationEvent["actor"],
      summary: e.summary,
      data: e.data as Record<string, unknown>,
    })),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
    completedAt: row.completedAt && instantFromDb(row.completedAt),
  };

  return Obligation.restore(props);
}

function viewWhere(filter: ObligationFilter): Prisma.ComplianceObligationWhereInput {
  const now = instantToDb(filter.now);
  const open = [...OPEN_STATUSES];

  switch (filter.view ?? "all") {
    case "due":
      return { status: { in: open }, lateFrom: { gt: now } };
    case "overdue":
      return { status: { in: open }, lateFrom: { lte: now } };
    case "rejected":
      return { status: "rejected" };
    case "done":
      return { status: { in: ["submitted", "accepted", "completed", "waived"] } };
    case "all":
      return {};
  }
}

export class PrismaObligationRepository implements ObligationRepository {
  async findById(tx: Transaction, ctx: TenantContext, id: ObligationId) {
    const row = await prismaTx(tx).complianceObligation.findFirst({
      where: { tenantId: ctx.tenantId, id },
      include,
    });

    return row && toDomain(row);
  }

  async findByDedupeKey(tx: Transaction, ctx: TenantContext, key: string) {
    const row = await prismaTx(tx).complianceObligation.findUnique({
      where: { tenantId_dedupeKey: { tenantId: ctx.tenantId, dedupeKey: key } },
      include,
    });

    return row && toDomain(row);
  }

  async list(tx: Transaction, ctx: TenantContext, filter: ObligationFilter) {
    const rows = await prismaTx(tx).complianceObligation.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...viewWhere(filter),
        ...(filter.kind && { kind: filter.kind }),
        ...(filter.jurisdiction && { jurisdiction: filter.jurisdiction }),
        ...(filter.policyId && { policyId: filter.policyId }),
        ...(filter.licenseeId && {
          licenseeId: filter.licenseeId === "tenant" ? null : filter.licenseeId,
        }),
      },
      include,
      orderBy: [{ lateFrom: "asc" }, { createdAt: "asc" }],
      take: filter.limit ?? 200,
    });

    return rows.map(toDomain);
  }

  async inPeriod(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      kind: ObligationKind;
      jurisdiction: string;
      licenseeId: string | null;
      from: string;
      to: string;
    },
  ) {
    const rows = await prismaTx(tx).complianceObligation.findMany({
      where: {
        tenantId: ctx.tenantId,
        subjectType: "transaction",
        kind: input.kind,
        jurisdiction: input.jurisdiction,
        licenseeId: input.licenseeId,
        anchorDate: {
          gte: new Date(`${input.from}T00:00:00Z`),
          lte: new Date(`${input.to}T00:00:00Z`),
        },
      },
      include,
      orderBy: { anchorDate: "asc" },
    });

    return rows.map(toDomain);
  }

  async save(tx: Transaction, obligation: Obligation): Promise<void> {
    const db = prismaTx(tx);
    const s = obligation.toSnapshot();

    const anchor =
      s.subject.periodStart ?? (s.data.issuedDate as string | undefined) ?? s.dueDate.toString();

    const fields = {
      status: s.status,
      title: s.title,
      responsible: json(s.responsible),
      licenseeId: s.responsible.licensee?.id ?? null,
      escalation: s.escalation,
      data: json(s.data),
      proof: s.proof ? json(s.proof) : undefined,
      waiver: s.waiver ? json(s.waiver) : undefined,
      updatedAt: instantToDb(s.updatedAt),
      completedAt: s.completedAt && instantToDb(s.completedAt),
    };

    await db.complianceObligation.upsert({
      where: { id: s.id },
      update: fields,
      create: {
        ...fields,
        id: s.id,
        tenantId: s.tenantId,
        dedupeKey: s.dedupeKey,
        kind: s.kind,
        code: s.code,
        jurisdiction: s.jurisdiction.subdivision ?? s.jurisdiction.country,
        country: s.jurisdiction.country,
        subjectType: s.subject.type,
        policyId: s.subject.policyId,
        transactionId: s.subject.transactionId,
        anchorDate: new Date(`${anchor}T00:00:00Z`),
        subject: json(s.subject),
        channel: s.channel,
        rule: json(s.rule),
        timer: json(s.timer),
        dueDate: dateToDb(s.dueDate),
        lateFrom: instantToDb(s.lateFrom),
        source: json(s.source),
        createdAt: instantToDb(s.createdAt),
      },
    });

    for (const f of s.filings) {
      const values = {
        status: f.status,
        reference: f.reference,
        filingNumber: f.filingNumber,
        stampNumber: f.stampNumber,
        reasons: json(f.reasons),
        submittedAt: instantToDb(f.submittedAt),
        respondedAt: f.respondedAt && instantToDb(f.respondedAt),
      };

      await db.complianceFiling.upsert({
        where: { id: f.id },
        update: values,
        create: {
          ...values,
          id: f.id,
          tenantId: s.tenantId,
          obligationId: s.id,
          attempt: f.attempt,
          providerId: f.providerId,
          delivery: f.delivery,
          batchId: f.batchId,
        },
      });
    }

    const added = obligation.pullAddedEvents();

    if (added.length > 0) {
      await db.complianceObligationEvent.createMany({
        data: added.map((e) => ({
          id: e.id,
          tenantId: s.tenantId,
          obligationId: s.id,
          type: e.type,
          occurredAt: instantToDb(e.occurredAt),
          actor: json(e.actor),
          summary: e.summary,
          data: json(e.data),
        })),
      });
    }
  }

  async saveBatch(tx: Transaction, ctx: TenantContext, batch: FilingBatch) {
    await prismaTx(tx).complianceFilingBatch.create({
      data: {
        id: batch.id,
        tenantId: ctx.tenantId,
        providerId: batch.providerId,
        kind: batch.kind,
        jurisdiction: batch.jurisdiction,
        fileKey: batch.fileKey,
        fileName: batch.fileName,
        contentType: batch.contentType,
        checklist: batch.checklist,
        obligationIds: batch.obligationIds,
        createdAt: instantToDb(batch.createdAt),
      },
    });
  }

  async findBatch(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).complianceFilingBatch.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && batchOf(row);
  }

  async listBatches(tx: Transaction, ctx: TenantContext, limit: number) {
    const rows = await prismaTx(tx).complianceFilingBatch.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map(batchOf);
  }
}

function batchOf(row: Prisma.ComplianceFilingBatchGetPayload<object>): FilingBatch {
  return {
    id: row.id,
    providerId: row.providerId,
    kind: row.kind,
    jurisdiction: row.jurisdiction,
    fileKey: row.fileKey,
    fileName: row.fileName,
    contentType: row.contentType,
    checklist: row.checklist as string[],
    obligationIds: row.obligationIds as string[],
    createdAt: instantFromDb(row.createdAt),
  };
}

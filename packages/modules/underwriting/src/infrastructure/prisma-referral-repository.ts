import { instantFromDb, instantToDb, jsonToDb, prismaTx } from "@pas/db";
import { Prisma } from "@pas/db/client";
import { asId, jurisdiction, Money, type TenantContext, type Transaction } from "@pas/kernel";
import {
  Referral,
  type ReferralEntry,
  type ReferralId,
  type ReferralProps,
} from "../domain/referral";
import type { ReferralFilter, ReferralRepository } from "../ports/repositories";
import { revive } from "./json";

const include = {
  entries: { orderBy: { at: "asc" } },
} satisfies Prisma.UnderwritingReferralInclude;

type Row = Prisma.UnderwritingReferralGetPayload<{ include: typeof include }>;
type MoneyJson = { amount: string; currency: string };

interface QuoteJson extends Omit<
  ReferralProps["quote"],
  "writtenPremium" | "total" | "insuredValue" | "dueAt"
> {
  writtenPremium: MoneyJson;
  total: MoneyJson;
  insuredValue: MoneyJson;
  dueAt: string;
}

function toDomain(row: Row): Referral {
  const quote = row.quote as unknown as QuoteJson;

  return Referral.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    quoteId: row.quoteId,
    submissionId: row.submissionId,
    submissionNumber: row.submissionNumber,
    productId: row.productId,
    productName: row.productName,
    jurisdiction: jurisdiction(row.country, row.subdivision),
    insuredName: row.insuredName,
    producer: row.producer as unknown as ReferralProps["producer"],
    status: row.status as ReferralProps["status"],
    quote: {
      ...quote,
      writtenPremium: Money.fromJSON(quote.writtenPremium),
      total: Money.fromJSON(quote.total),
      insuredValue: Money.fromJSON(quote.insuredValue),
      dueAt: Temporal.Instant.from(quote.dueAt),
    },
    requiredLevel: row.requiredLevel,
    assignee: row.assignee as ReferralProps["assignee"],
    escalation: row.escalation ? revive(row.escalation, ["at"]) : null,
    decision: row.decision ? revive(row.decision, ["at"]) : null,
    entries: row.entries.map((e): ReferralEntry => ({
      id: e.id,
      kind: e.kind as ReferralEntry["kind"],
      visibility: e.visibility as ReferralEntry["visibility"],
      author: e.author as unknown as ReferralEntry["author"],
      ...(e.action && { action: e.action as ReferralEntry["action"] }),
      body: e.body,
      data: e.data as Record<string, unknown>,
      at: instantFromDb(e.at),
    })),
    openedAt: instantFromDb(row.openedAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}

export class PrismaReferralRepository implements ReferralRepository {
  async save(tx: Transaction, referral: Referral): Promise<void> {
    const db = prismaTx(tx);
    const r = referral.toSnapshot();

    const fields = {
      status: r.status,
      insuredName: r.insuredName,
      quote: jsonToDb(r.quote),
      requiredLevel: r.requiredLevel,
      assigneeId: r.assignee?.id ?? null,
      assignee: r.assignee ? jsonToDb(r.assignee) : Prisma.DbNull,
      escalation: r.escalation ? jsonToDb(r.escalation) : undefined,
      decision: r.decision ? jsonToDb(r.decision) : undefined,
      dueAt: instantToDb(r.quote.dueAt),
      updatedAt: instantToDb(r.updatedAt),
    };

    await db.underwritingReferral.upsert({
      where: { id: r.id },
      update: fields,
      create: {
        ...fields,
        id: r.id,
        tenantId: r.tenantId,
        quoteId: r.quoteId,
        submissionId: r.submissionId,
        submissionNumber: r.submissionNumber,
        productId: r.productId,
        productName: r.productName,
        country: r.jurisdiction.country,
        subdivision: r.jurisdiction.subdivision ?? null,
        producer: jsonToDb(r.producer),
        openedAt: instantToDb(r.openedAt),
      },
    });

    const added = referral.pullAdded();

    if (added.length > 0) {
      await db.underwritingReferralEntry.createMany({
        data: added.map((e) => ({
          id: e.id,
          tenantId: r.tenantId,
          referralId: r.id,
          kind: e.kind,
          visibility: e.visibility,
          action: e.action ?? null,
          author: jsonToDb(e.author),
          body: e.body,
          data: jsonToDb(e.data),
          at: instantToDb(e.at),
        })),
      });
    }
  }

  async findById(tx: Transaction, ctx: TenantContext, id: ReferralId) {
    const row = await prismaTx(tx).underwritingReferral.findFirst({
      where: { tenantId: ctx.tenantId, id },
      include,
    });

    return row && toDomain(row);
  }

  async findOpenByQuote(tx: Transaction, ctx: TenantContext, quoteId: string) {
    const row = await prismaTx(tx).underwritingReferral.findFirst({
      where: {
        tenantId: ctx.tenantId,
        quoteId,
        status: { in: ["open", "escalated", "info_requested"] },
      },
      include,
      orderBy: { openedAt: "desc" },
    });

    return row && toDomain(row);
  }

  async listByQuote(tx: Transaction, ctx: TenantContext, quoteId: string) {
    const rows = await prismaTx(tx).underwritingReferral.findMany({
      where: { tenantId: ctx.tenantId, quoteId },
      include,
      orderBy: { openedAt: "desc" },
    });

    return rows.map(toDomain);
  }

  async list(tx: Transaction, ctx: TenantContext, filter: ReferralFilter) {
    const [country, subdivision] = filter.jurisdiction
      ? [
          filter.jurisdiction.slice(0, 2),
          filter.jurisdiction.includes("-") ? filter.jurisdiction : null,
        ]
      : [undefined, undefined];

    const rows = await prismaTx(tx).underwritingReferral.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.statuses && { status: { in: [...filter.statuses] } }),
        ...(filter.productId && { productId: filter.productId }),
        ...(country && { country }),
        ...(subdivision && { subdivision }),
        ...(filter.assigneeId !== undefined && { assigneeId: filter.assigneeId }),
        ...(filter.openedBefore && { openedAt: { lte: instantToDb(filter.openedBefore) } }),
        ...(filter.submissionIds && { submissionId: { in: [...filter.submissionIds] } }),
      },
      include,
      orderBy: { dueAt: "asc" },
      take: filter.limit ?? 200,
    });

    return rows.map(toDomain);
  }
}

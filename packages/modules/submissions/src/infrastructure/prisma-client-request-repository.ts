import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import type { QuoteClientRequest as Row } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { ClientRequest, type ClientRequestId } from "../domain/client-request";
import type { ClientRequestRepository } from "../ports/client-request-repository";

const optional = (value: Date | null) => (value ? instantFromDb(value) : null);

const toDomain = (row: Row) =>
  ClientRequest.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    quoteId: row.quoteId,
    submissionId: row.submissionId,
    submissionNumber: row.submissionNumber,
    producerId: row.producerId,
    email: row.email,
    name: row.name,
    sentBy: { userId: row.sentByUserId, name: row.sentByName },
    sentAt: instantFromDb(row.sentAt),
    openedAt: optional(row.openedAt),
    completedAt: optional(row.completedAt),
    revokedAt: optional(row.revokedAt),
    expiresAt: instantFromDb(row.expiresAt),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });

const instantOrNull = (value: Temporal.Instant | null) => (value ? instantToDb(value) : null);

export class PrismaClientRequestRepository implements ClientRequestRepository {
  async save(tx: Transaction, request: ClientRequest): Promise<void> {
    const r = request.toSnapshot();

    const fields = {
      email: r.email,
      name: r.name,
      sentByUserId: r.sentBy.userId,
      sentByName: r.sentBy.name,
      sentAt: instantToDb(r.sentAt),
      openedAt: instantOrNull(r.openedAt),
      completedAt: instantOrNull(r.completedAt),
      revokedAt: instantOrNull(r.revokedAt),
      expiresAt: instantToDb(r.expiresAt),
      updatedAt: instantToDb(r.updatedAt),
    };

    await prismaTx(tx).quoteClientRequest.upsert({
      where: { id: r.id },
      update: fields,
      create: {
        ...fields,
        id: r.id,
        tenantId: r.tenantId,
        quoteId: r.quoteId,
        submissionId: r.submissionId,
        submissionNumber: r.submissionNumber,
        producerId: r.producerId,
        createdAt: instantToDb(r.createdAt),
      },
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: ClientRequestId) {
    const row = await prismaTx(tx).quoteClientRequest.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toDomain(row);
  }

  async findLatestByQuote(tx: Transaction, ctx: TenantContext, quoteId: string) {
    const row = await prismaTx(tx).quoteClientRequest.findFirst({
      where: { tenantId: ctx.tenantId, quoteId },
      orderBy: { createdAt: "desc" },
    });

    return row && toDomain(row);
  }
}

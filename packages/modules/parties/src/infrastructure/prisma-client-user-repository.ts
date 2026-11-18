import { prismaTx } from "@pas/db";
import { type Instant, newId, type TenantContext, type Transaction } from "@pas/kernel";
import type {
  ClientUserLink,
  ClientUserMethod,
  ClientUserRepository,
} from "../ports/client-user-repository";

const toDate = (i: Instant) => new Date(i.epochMilliseconds);

const toLink = (row: {
  userId: string;
  clientAccountId: string;
  method: string;
  verifiedAt: Date;
}) => ({
  userId: row.userId,
  clientAccountId: row.clientAccountId,
  method: row.method as ClientUserMethod,
  verifiedAt: Temporal.Instant.fromEpochMilliseconds(row.verifiedAt.getTime()),
});

export class PrismaClientUserRepository implements ClientUserRepository {
  async link(tx: Transaction, ctx: TenantContext, link: ClientUserLink): Promise<void> {
    await prismaTx(tx).clientUser.createMany({
      data: [
        {
          id: newId(),
          tenantId: ctx.tenantId,
          userId: link.userId,
          clientAccountId: link.clientAccountId,
          method: link.method,
          verifiedAt: toDate(link.verifiedAt),
        },
      ],
      skipDuplicates: true,
    });
  }

  async listForUser(tx: Transaction, ctx: TenantContext, userId: string) {
    const rows = await prismaTx(tx).clientUser.findMany({
      where: { tenantId: ctx.tenantId, userId },
      orderBy: { verifiedAt: "asc" },
    });

    return rows.map(toLink);
  }

  async listForAccounts(tx: Transaction, ctx: TenantContext, accountIds: readonly string[]) {
    if (accountIds.length === 0) return [];

    const rows = await prismaTx(tx).clientUser.findMany({
      where: { tenantId: ctx.tenantId, clientAccountId: { in: [...accountIds] } },
    });

    return rows.map(toLink);
  }

  async moveAccount(tx: Transaction, ctx: TenantContext, from: string, to: string): Promise<void> {
    const db = prismaTx(tx);

    const moving = await db.clientUser.findMany({
      where: { tenantId: ctx.tenantId, clientAccountId: from },
    });

    if (moving.length > 0) {
      await db.clientUser.createMany({
        data: moving.map((row) => ({ ...row, id: newId(), clientAccountId: to })),
        skipDuplicates: true,
      });
    }

    await db.clientUser.deleteMany({ where: { tenantId: ctx.tenantId, clientAccountId: from } });
  }

  async recordClaimAttempt(
    tx: Transaction,
    ctx: TenantContext,
    attempt: { userId: string; policyNumber: string; succeeded: boolean; attemptedAt: Instant },
  ): Promise<void> {
    await prismaTx(tx).clientClaimAttempt.create({
      data: {
        id: newId(),
        tenantId: ctx.tenantId,
        userId: attempt.userId,
        policyNumber: attempt.policyNumber,
        succeeded: attempt.succeeded,
        attemptedAt: toDate(attempt.attemptedAt),
      },
    });
  }

  async countFailedClaims(
    tx: Transaction,
    ctx: TenantContext,
    userId: string,
    since: Instant,
  ): Promise<number> {
    return prismaTx(tx).clientClaimAttempt.count({
      where: {
        tenantId: ctx.tenantId,
        userId,
        succeeded: false,
        attemptedAt: { gte: toDate(since) },
      },
    });
  }
}

import { instantToDb, prismaTx } from "@pas/db";
import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { RecentType } from "../domain/recent";
import type { RecentViewRepository } from "../ports/recent-views";

export class PrismaRecentViews implements RecentViewRepository {
  async record(
    tx: Transaction,
    ctx: TenantContext,
    view: { userId: string; type: RecentType; id: string; at: Instant },
    keep: number,
  ): Promise<void> {
    const db = prismaTx(tx);
    const key = { tenantId: ctx.tenantId, userId: view.userId };
    const viewedAt = instantToDb(view.at);

    await db.recentView.upsert({
      where: {
        tenantId_userId_recordType_recordId: { ...key, recordType: view.type, recordId: view.id },
      },
      create: { ...key, recordType: view.type, recordId: view.id, viewedAt },
      update: { viewedAt },
    });

    const stale = await db.recentView.findMany({
      where: key,
      orderBy: { viewedAt: "desc" },
      skip: keep,
      select: { recordType: true, recordId: true },
    });

    if (stale.length === 0) return;

    await db.recentView.deleteMany({
      where: { ...key, OR: stale.map((s) => ({ recordType: s.recordType, recordId: s.recordId })) },
    });
  }

  async list(tx: Transaction, ctx: TenantContext, userId: string, limit: number) {
    const rows = await prismaTx(tx).recentView.findMany({
      where: { tenantId: ctx.tenantId, userId },
      orderBy: { viewedAt: "desc" },
      take: limit,
      select: { recordType: true, recordId: true },
    });

    return rows.map((r) => ({ type: r.recordType as RecentType, id: r.recordId }));
  }
}

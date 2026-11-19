import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import { newId, type Instant, type TenantContext, type Transaction } from "@pas/kernel";
import type { SubjectKind } from "../domain/event-types";
import type { NotificationRecord, NotificationRepository } from "../ports/notification-repository";
import { maybeInstant } from "./mappers";

export class PrismaNotificationRepository implements NotificationRepository {
  async add(
    tx: Transaction,
    ctx: TenantContext,
    notifications: NotificationRecord[],
  ): Promise<void> {
    if (notifications.length === 0) return;

    await prismaTx(tx).notification.createMany({
      data: notifications.map((n) => ({
        id: n.id,
        tenantId: ctx.tenantId,
        userId: n.userId,
        eventId: n.eventId,
        eventType: n.eventType,
        title: n.title,
        body: n.body,
        subjectKind: n.subject?.kind ?? null,
        subjectId: n.subject?.id ?? null,
        readAt: null,
        createdAt: instantToDb(n.createdAt),
      })),
      skipDuplicates: true,
    });
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    input: { userId: string; limit: number; unreadOnly: boolean },
  ): Promise<NotificationRecord[]> {
    const rows = await prismaTx(tx).notification.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: input.userId,
        ...(input.unreadOnly && { readAt: null }),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      eventId: row.eventId,
      eventType: row.eventType,
      title: row.title,
      body: row.body,
      subject:
        row.subjectKind && row.subjectId
          ? { kind: row.subjectKind as SubjectKind, id: row.subjectId }
          : null,
      readAt: maybeInstant(row.readAt),
      createdAt: instantFromDb(row.createdAt),
    }));
  }

  unreadCount(tx: Transaction, ctx: TenantContext, userId: string): Promise<number> {
    return prismaTx(tx).notification.count({
      where: { tenantId: ctx.tenantId, userId, readAt: null },
    });
  }

  async markRead(
    tx: Transaction,
    ctx: TenantContext,
    input: { userId: string; ids: readonly string[] | "all"; at: Instant },
  ): Promise<void> {
    await prismaTx(tx).notification.updateMany({
      where: {
        tenantId: ctx.tenantId,
        userId: input.userId,
        readAt: null,
        ...(input.ids !== "all" && { id: { in: [...input.ids] } }),
      },
      data: { readAt: instantToDb(input.at) },
    });
  }

  async preferences(tx: Transaction, ctx: TenantContext, userIds: readonly string[]) {
    if (userIds.length === 0) return new Map<string, string[]>();

    const rows = await prismaTx(tx).notificationPreference.findMany({
      where: { tenantId: ctx.tenantId, userId: { in: [...userIds] } },
    });

    return new Map(rows.map((row) => [row.userId, row.eventTypes]));
  }

  async savePreferences(
    tx: Transaction,
    ctx: TenantContext,
    input: { userId: string; eventTypes: string[]; at: Instant },
  ): Promise<void> {
    await prismaTx(tx).notificationPreference.upsert({
      where: { tenantId_userId: { tenantId: ctx.tenantId, userId: input.userId } },
      create: {
        id: newId(),
        tenantId: ctx.tenantId,
        userId: input.userId,
        eventTypes: input.eventTypes,
        updatedAt: instantToDb(input.at),
      },
      update: { eventTypes: input.eventTypes, updatedAt: instantToDb(input.at) },
    });
  }
}

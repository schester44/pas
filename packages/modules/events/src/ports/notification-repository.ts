import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { EventSubject } from "../domain/event-types";

export interface NotificationRecord {
  id: string;
  userId: string;
  eventId: string;
  eventType: string;
  title: string;
  body: string;
  subject: EventSubject | null;
  readAt: Instant | null;
  createdAt: Instant;
}

export interface NotificationRepository {
  add(tx: Transaction, ctx: TenantContext, notifications: NotificationRecord[]): Promise<void>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    input: { userId: string; limit: number; unreadOnly: boolean },
  ): Promise<NotificationRecord[]>;
  unreadCount(tx: Transaction, ctx: TenantContext, userId: string): Promise<number>;
  markRead(
    tx: Transaction,
    ctx: TenantContext,
    input: { userId: string; ids: readonly string[] | "all"; at: Instant },
  ): Promise<void>;
  preferences(
    tx: Transaction,
    ctx: TenantContext,
    userIds: readonly string[],
  ): Promise<Map<string, string[]>>;
  savePreferences(
    tx: Transaction,
    ctx: TenantContext,
    input: { userId: string; eventTypes: string[]; at: Instant },
  ): Promise<void>;
}

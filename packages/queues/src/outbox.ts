import type { DomainEvent, Outbox, Transaction } from "@pas/kernel";
import { fromPrisma, type PrismaTransactionLike } from "pg-boss";
import type { QueueClient } from "./client";
import { domainEventsQueue } from "./queues/domain-events";

/**
 * Outbox adapter: enqueues domain events with pg-boss *inside the caller's Prisma transaction*,
 * so an event exists if and only if the state change committed. No outbox table or relay needed.
 * Consumers are at-least-once and must be idempotent on event id.
 */
export class PgBossOutbox implements Outbox {
  constructor(private readonly queues: QueueClient) {}

  async add(tx: Transaction, events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.queues.start();
    const db = fromPrisma(tx as unknown as PrismaTransactionLike);
    for (const event of events) {
      await this.queues.boss.send(
        domainEventsQueue.name,
        domainEventsQueue.schema.parse({
          id: event.id,
          type: event.type,
          tenantId: event.tenantId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          occurredAt: event.occurredAt.toString(),
          payload: event.payload,
        }),
        { ...domainEventsQueue.sendOptions, db, singletonKey: event.id },
      );
    }
  }
}

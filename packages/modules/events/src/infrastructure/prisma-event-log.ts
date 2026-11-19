import { prismaTx } from "@pas/db";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { EventEnvelope } from "../application/payloads";
import { type AttemptTrigger, Delivery, type DeliveryStatus } from "../domain/delivery";
import type { SubjectKind } from "../domain/event-types";
import type { AttemptRecord, EventLog, OutboundEventRecord } from "../ports/event-log";
import { json, maybeDate, maybeInstant, toDate, toInstant } from "./mappers";

type Db = ReturnType<typeof prismaTx>;
type DeliveryRow = Awaited<ReturnType<Db["eventDelivery"]["findFirstOrThrow"]>>;

const toDelivery = (row: DeliveryRow) =>
  Delivery.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    subscriptionId: row.subscriptionId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status as DeliveryStatus,
    attempts: row.attempts,
    nextAttemptAt: maybeInstant(row.nextAttemptAt),
    lastAttemptAt: maybeInstant(row.lastAttemptAt),
    lastStatusCode: row.lastStatusCode,
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  });

const deliveryData = (delivery: Delivery) => {
  const d = delivery.toSnapshot();

  return {
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: maybeDate(d.nextAttemptAt),
    lastAttemptAt: maybeDate(d.lastAttemptAt),
    lastStatusCode: d.lastStatusCode,
    updatedAt: toDate(d.updatedAt),
  };
};

export class PrismaEventLog implements EventLog {
  async addEvent(
    tx: Transaction,
    ctx: TenantContext,
    event: OutboundEventRecord,
  ): Promise<boolean> {
    const created = await prismaTx(tx).outboundEvent.createMany({
      data: [
        {
          id: event.id,
          tenantId: ctx.tenantId,
          type: event.type,
          sourceEventId: event.sourceEventId,
          environment: event.environment,
          test: event.test,
          subjectKind: event.subject?.kind ?? null,
          subjectId: event.subject?.id ?? null,
          envelope: json(event.envelope),
          occurredAt: toDate(event.occurredAt),
          createdAt: toDate(event.createdAt),
        },
      ],
      skipDuplicates: true,
    });

    return created.count > 0;
  }

  async findEvent(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).outboundEvent.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return (
      row && {
        id: row.id,
        type: row.type,
        sourceEventId: row.sourceEventId,
        environment: row.environment as OutboundEventRecord["environment"],
        test: row.test,
        subject:
          row.subjectKind && row.subjectId
            ? { kind: row.subjectKind as SubjectKind, id: row.subjectId }
            : null,
        envelope: row.envelope as EventEnvelope,
        occurredAt: toInstant(row.occurredAt),
        createdAt: toInstant(row.createdAt),
      }
    );
  }

  async addDelivery(tx: Transaction, delivery: Delivery): Promise<void> {
    const d = delivery.toSnapshot();

    await prismaTx(tx).eventDelivery.create({
      data: {
        id: d.id,
        tenantId: d.tenantId,
        subscriptionId: d.subscriptionId,
        eventId: d.eventId,
        eventType: d.eventType,
        createdAt: toDate(d.createdAt),
        ...deliveryData(delivery),
      },
    });
  }

  async saveDelivery(tx: Transaction, delivery: Delivery): Promise<void> {
    const d = delivery.toSnapshot();

    await prismaTx(tx).eventDelivery.updateMany({
      where: { tenantId: d.tenantId, id: d.id },
      data: deliveryData(delivery),
    });
  }

  async findDelivery(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).eventDelivery.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toDelivery(row);
  }

  async listDeliveries(
    tx: Transaction,
    ctx: TenantContext,
    input: { subscriptionId: string; limit: number },
  ) {
    const rows = await prismaTx(tx).eventDelivery.findMany({
      where: { tenantId: ctx.tenantId, subscriptionId: input.subscriptionId },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });

    return rows.map(toDelivery);
  }

  async addAttempt(tx: Transaction, ctx: TenantContext, attempt: AttemptRecord): Promise<void> {
    await prismaTx(tx).eventDeliveryAttempt.create({
      data: {
        id: attempt.id,
        tenantId: ctx.tenantId,
        deliveryId: attempt.deliveryId,
        attempt: attempt.attempt,
        trigger: attempt.trigger,
        request: json(attempt.request),
        statusCode: attempt.statusCode,
        responseBody: attempt.responseBody,
        error: attempt.error,
        durationMs: attempt.durationMs,
        attemptedAt: toDate(attempt.attemptedAt),
      },
    });
  }

  async listAttempts(tx: Transaction, ctx: TenantContext, deliveryId: string) {
    const rows = await prismaTx(tx).eventDeliveryAttempt.findMany({
      where: { tenantId: ctx.tenantId, deliveryId },
      orderBy: { attempt: "desc" },
    });

    return rows.map((row): AttemptRecord => ({
      id: row.id,
      deliveryId: row.deliveryId,
      attempt: row.attempt,
      trigger: row.trigger as AttemptTrigger,
      request: row.request as AttemptRecord["request"],
      statusCode: row.statusCode,
      responseBody: row.responseBody,
      error: row.error,
      durationMs: row.durationMs,
      attemptedAt: toInstant(row.attemptedAt),
    }));
  }
}

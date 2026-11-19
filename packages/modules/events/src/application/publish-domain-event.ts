import { type Instant, newId, type TenantContext, type Transaction } from "@pas/kernel";
import { Delivery } from "../domain/delivery";
import { CATALOG_VERSION } from "../domain/event-types";
import { subscriptionMatches } from "../domain/matching";
import { recipientsOf } from "../domain/recipients";
import type { Subscription } from "../domain/subscription";
import type { OutboundEventRecord } from "../ports/event-log";
import type { TenantMember, TenantMembers } from "../ports/platform";
import type { EventSubjects } from "../ports/subjects";
import { catalogEntry } from "./catalog";
import { type EventsDeps, systemContext } from "./deps";
import { type InternalEvent, mapDomainEvent, type PublicEventDraft } from "./map-domain-event";
import type { EventEnvelope } from "./payloads";

export function buildRecord(input: {
  draft: PublicEventDraft;
  sourceEventId: string;
  occurredAt: Instant;
  sandbox: boolean;
  test: boolean;
  now: Instant;
}): OutboundEventRecord {
  const id = newId();
  const environment = input.sandbox ? "sandbox" : "production";

  const envelope: EventEnvelope = {
    id: `evt_${id.replaceAll("-", "")}`,
    object: "event",
    type: input.draft.type,
    apiVersion: CATALOG_VERSION,
    createdAt: input.occurredAt.toString(),
    environment,
    ...(input.test && { test: true }),
    data: input.draft.data,
  };

  return {
    id,
    type: input.draft.type,
    sourceEventId: input.sourceEventId,
    environment,
    test: input.test,
    subject: catalogEntry(input.draft.type).subject(input.draft.data as never),
    envelope,
    occurredAt: input.occurredAt,
    createdAt: input.now,
  };
}

/** Fans one stored event out to matching destinations, in the same transaction. */
export async function fanOut(
  deps: Pick<EventsDeps, "log" | "queue" | "clocks">,
  tx: Transaction,
  ctx: TenantContext,
  record: OutboundEventRecord,
  subscriptions: readonly Subscription[],
): Promise<number> {
  const entry = catalogEntry(record.type as PublicEventDraft["type"]);
  const event = { type: record.type, facets: entry.facets(record.envelope.data as never) };
  const clock = deps.clocks.forTenant(ctx.tenantId);
  let count = 0;

  for (const subscription of subscriptions) {
    if (!subscriptionMatches(subscription.toSubscriber(), event)) continue;

    const delivery = Delivery.create(
      {
        tenantId: ctx.tenantId,
        subscriptionId: subscription.id,
        eventId: record.id,
        eventType: record.type,
      },
      clock,
    );

    await deps.log.addDelivery(tx, delivery);

    await deps.queue.enqueue(tx, {
      tenantId: ctx.tenantId,
      deliveryId: delivery.id,
      trigger: "automatic",
    });

    count++;
  }

  return count;
}

/**
 * The domain-events consumer: maps an internal event to public ones, stores each once,
 * queues a delivery per matching subscription and writes in-app notifications.
 * Idempotent on the domain event id.
 */
export function makePublishDomainEvent(
  deps: EventsDeps & { subjects: EventSubjects; members: TenantMembers },
) {
  return async function publishDomainEvent(
    event: InternalEvent,
  ): Promise<{ published: number; deliveries: number; notified: number }> {
    const ctx = systemContext(event.tenantId);
    const drafts = await mapDomainEvent(event, deps.subjects, ctx);
    const result = { published: 0, deliveries: 0, notified: 0 };

    if (drafts.length === 0) return result;

    const [sandbox, members] = await Promise.all([
      deps.environments.isSandbox(ctx.tenantId),
      deps.members.list(ctx),
    ]);

    const audience = members.filter(
      (m): m is TenantMember & { audience: NonNullable<TenantMember["audience"]> } =>
        m.audience !== null,
    );

    const clock = deps.clocks.forTenant(ctx.tenantId);

    await deps.uow.run(ctx, async (tx) => {
      const subscriptions = (await deps.subscriptions.list(tx, ctx)).filter((s) => s.isActive);

      const preferences = await deps.notifications.preferences(
        tx,
        ctx,
        audience.map((m) => m.userId),
      );

      for (const draft of drafts) {
        const now = clock.now();

        const record = buildRecord({
          draft,
          sourceEventId: event.id,
          occurredAt: Temporal.Instant.from(event.occurredAt),
          sandbox,
          test: false,
          now,
        });

        if (!(await deps.log.addEvent(tx, ctx, record))) continue;

        result.published++;
        result.deliveries += await fanOut(deps, tx, ctx, record, subscriptions);

        const entry = catalogEntry(draft.type);
        const data = draft.data as never;
        const message = entry.message(data);

        const recipients = recipientsOf({
          type: draft.type,
          producerId: entry.producerId(data),
          members: audience,
          preferences,
        });

        await deps.notifications.add(
          tx,
          ctx,
          recipients.map((userId) => ({
            id: newId(),
            userId,
            eventId: record.id,
            eventType: draft.type,
            title: message.title,
            body: message.body,
            subject: record.subject,
            readAt: null,
            createdAt: now,
          })),
        );

        result.notified += recipients.length;
      }
    });

    return result;
  };
}

export type PublishDomainEvent = ReturnType<typeof makePublishDomainEvent>;

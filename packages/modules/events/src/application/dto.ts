import type { Delivery } from "../domain/delivery";
import type { Subscription } from "../domain/subscription";
import type { AttemptRecord, OutboundEventRecord } from "../ports/event-log";
import type { NotificationRecord } from "../ports/notification-repository";

export interface SubscriptionDto {
  id: string;
  kind: "webhook" | "chat";
  name: string;
  url: string | null;
  eventTypes: string[];
  filter: string | null;
  status: "active" | "disabled";
  disabledReason: string | null;
  secretHint: string | null;
  failingSince: string | null;
  lastSuccessAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSubscriptionDto(subscription: Subscription): SubscriptionDto {
  const s = subscription.toSnapshot();

  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    url: s.url,
    eventTypes: s.eventTypes,
    filter: s.filter,
    status: s.status,
    disabledReason: s.disabledReason,
    secretHint: s.secretHint,
    failingSince: s.failingSince?.toString() ?? null,
    lastSuccessAt: s.lastSuccessAt?.toString() ?? null,
    createdAt: s.createdAt.toString(),
    updatedAt: s.updatedAt.toString(),
  };
}

export interface DeliveryDto {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  createdAt: string;
}

export function toDeliveryDto(delivery: Delivery): DeliveryDto {
  const d = delivery.toSnapshot();

  return {
    id: d.id,
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: d.nextAttemptAt?.toString() ?? null,
    lastAttemptAt: d.lastAttemptAt?.toString() ?? null,
    lastStatusCode: d.lastStatusCode,
    createdAt: d.createdAt.toString(),
  };
}

export const toAttemptDto = (a: AttemptRecord) => ({
  id: a.id,
  attempt: a.attempt,
  trigger: a.trigger,
  request: a.request,
  statusCode: a.statusCode,
  responseBody: a.responseBody,
  error: a.error,
  durationMs: a.durationMs,
  attemptedAt: a.attemptedAt.toString(),
});

export const toEventDto = (e: OutboundEventRecord) => ({
  id: e.envelope.id,
  type: e.type,
  environment: e.environment,
  test: e.test,
  occurredAt: e.occurredAt.toString(),
  envelope: e.envelope,
});

export const toNotificationDto = (n: NotificationRecord) => ({
  id: n.id,
  eventType: n.eventType,
  title: n.title,
  body: n.body,
  subject: n.subject,
  read: n.readAt !== null,
  createdAt: n.createdAt.toString(),
});

export type NotificationDto = ReturnType<typeof toNotificationDto>;

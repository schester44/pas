import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { EventEnvelope } from "../application/payloads";
import type { AttemptTrigger, Delivery } from "../domain/delivery";
import type { EventSubject } from "../domain/event-types";

export interface OutboundEventRecord {
  id: string;
  type: string;
  sourceEventId: string;
  environment: "production" | "sandbox";
  test: boolean;
  subject: EventSubject | null;
  envelope: EventEnvelope;
  occurredAt: Instant;
  createdAt: Instant;
}

export interface AttemptRecord {
  id: string;
  deliveryId: string;
  attempt: number;
  trigger: AttemptTrigger;
  request: { url: string; headers: Record<string, string> };
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  attemptedAt: Instant;
}

/** Published events, their deliveries and every attempt (the delivery log). */
export interface EventLog {
  /** False when the event was already published (the domain event arrived twice). */
  addEvent(tx: Transaction, ctx: TenantContext, event: OutboundEventRecord): Promise<boolean>;
  findEvent(tx: Transaction, ctx: TenantContext, id: string): Promise<OutboundEventRecord | null>;
  addDelivery(tx: Transaction, delivery: Delivery): Promise<void>;
  saveDelivery(tx: Transaction, delivery: Delivery): Promise<void>;
  findDelivery(tx: Transaction, ctx: TenantContext, id: string): Promise<Delivery | null>;
  listDeliveries(
    tx: Transaction,
    ctx: TenantContext,
    input: { subscriptionId: string; limit: number },
  ): Promise<Delivery[]>;
  addAttempt(tx: Transaction, ctx: TenantContext, attempt: AttemptRecord): Promise<void>;
  listAttempts(tx: Transaction, ctx: TenantContext, deliveryId: string): Promise<AttemptRecord[]>;
}

import {
  asId,
  type ClockProvider,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { DeliveryQueue } from "../ports/delivery-queue";
import type { EventLog } from "../ports/event-log";
import type { NotificationRepository } from "../ports/notification-repository";
import type { EventEnvironments, SigningSecretBox } from "../ports/platform";
import type { SubscriptionRepository } from "../ports/subscription-repository";

export interface EventsDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  subscriptions: SubscriptionRepository;
  log: EventLog;
  notifications: NotificationRepository;
  queue: DeliveryQueue;
  secrets: SigningSecretBox;
  environments: EventEnvironments;
}

export const systemContext = (tenantId: string): TenantContext => ({
  tenantId: asId(tenantId),
  actor: { type: "system", process: "events" },
});

export const secretContext = (tenantId: string, subscriptionId: string) =>
  `${tenantId}:event_subscription:${subscriptionId}:signing`;

/** Shows enough of a secret to recognize it: `whsec_…3f9a`. */
export const hintOf = (secret: string) => `${secret.slice(0, 6)}…${secret.slice(-4)}`;

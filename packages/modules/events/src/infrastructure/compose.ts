import type { PrismaClient } from "@pas/db";
import type { ClockProvider, Outbox, TenantId, UnitOfWork } from "@pas/kernel";
import type { QueueClient } from "@pas/queues";
import type { EventsDeps } from "../application/deps";
import { makeDeliverEvent } from "../application/deliver-event";
import { makeGetEventCatalog } from "../application/get-event-catalog";
import { makeManageSubscriptions } from "../application/manage-subscriptions";
import { makeNotifications } from "../application/notifications";
import { makeNotifySubscriptionDisabled } from "../application/notify-subscription-disabled";
import { makePublishDomainEvent } from "../application/publish-domain-event";
import type { Audience, EventSubject } from "../domain/event-types";
import type { AdminMailer } from "../ports/platform";
import type { EventSubjects } from "../ports/subjects";
import { HttpWebhookTransport } from "./http-webhook-transport";
import { PgBossDeliveryQueue } from "./pg-boss-delivery-queue";
import { PrismaEventLog } from "./prisma-event-log";
import { PrismaNotificationRepository } from "./prisma-notification-repository";
import { PrismaSubscriptionRepository } from "./prisma-subscription-repository";
import { PrismaTenantMembers } from "./prisma-tenant-members";
import { type ResolvedChat, ResolvedChatTransport } from "./resolved-chat-transport";
import { SealedSigningSecrets } from "./signing-secret-box";

const ADMIN_PATHS: Record<EventSubject["kind"], string> = {
  submission: "/submissions/",
  policy: "/policies/",
  obligation: "/compliance/",
};

const unavailable = () => {
  throw new Error("Publishing needs the subjects and mailer adapters (worker only)");
};

/** Event catalog, subscriptions, deliveries and notifications, shared by the api and worker. */
export function composeEvents(deps: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  queues: QueueClient;
  secretBox: ConstructorParameters<typeof SealedSigningSecrets>[0];
  isSandbox: (tenantId: TenantId) => Promise<boolean>;
  /** Local development may send to localhost from any tenant; production only from sandboxes. */
  allowPrivateUrls: boolean;
  chat: (
    ctx: Parameters<ConstructorParameters<typeof ResolvedChatTransport>[0]>[0],
  ) => Promise<ResolvedChat | null>;
  classify: (role: string) => { audience: Audience | null; admin: boolean };
  adminOrigin: string;
  subjects?: EventSubjects;
  mailer?: AdminMailer;
}) {
  const shared: EventsDeps = {
    uow: deps.uow,
    outbox: deps.outbox,
    clocks: deps.clocks,
    subscriptions: new PrismaSubscriptionRepository(),
    log: new PrismaEventLog(),
    notifications: new PrismaNotificationRepository(),
    queue: new PgBossDeliveryQueue(deps.queues),
    secrets: new SealedSigningSecrets(deps.secretBox),
    environments: {
      isSandbox: deps.isSandbox,
      allowsPrivateUrls: async (tenantId) =>
        deps.allowPrivateUrls || (await deps.isSandbox(tenantId)),
    },
  };

  const webhooks = new HttpWebhookTransport();
  const chat = new ResolvedChatTransport(deps.chat);
  const members = new PrismaTenantMembers(deps.prisma, deps.classify);
  const adminUrl = (path: string) => new URL(path, deps.adminOrigin).toString();

  const links = {
    url: (subject: EventSubject | null) =>
      subject ? adminUrl(`${ADMIN_PATHS[subject.kind]}${subject.id}`) : null,
    settings: adminUrl,
  };

  return {
    catalog: makeGetEventCatalog(),
    subscriptions: makeManageSubscriptions({ ...shared, webhooks, chat }),
    notifications: makeNotifications(shared),
    deliver: makeDeliverEvent({ ...shared, webhooks, chat, links }),
    publish: deps.subjects
      ? makePublishDomainEvent({ ...shared, subjects: deps.subjects, members })
      : unavailable,
    notifyDisabled: deps.mailer
      ? makeNotifySubscriptionDisabled({ members, mailer: deps.mailer, links })
      : unavailable,
  };
}

export type Events = ReturnType<typeof composeEvents>;

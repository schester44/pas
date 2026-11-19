import { invalid, newId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import { Delivery } from "../domain/delivery";
import { isPublicEventType } from "../domain/event-types";
import { matchesPattern } from "../domain/matching";
import {
  Subscription,
  type SubscriptionKind,
  type SubscriptionSettings,
} from "../domain/subscription";
import type { ChatTransport, WebhookTransport } from "../ports/transports";
import { catalogEntry } from "./catalog";
import { type EventsDeps, hintOf, secretContext } from "./deps";
import { toAttemptDto, toDeliveryDto, toEventDto, toSubscriptionDto } from "./dto";
import { buildRecord } from "./publish-domain-event";

const userOf = (ctx: TenantContext) => (ctx.actor.type === "user" ? ctx.actor.userId : null);

/** Settings → Developers → Webhooks and Settings → Notifications (Slack). */
export function makeManageSubscriptions(
  deps: EventsDeps & { webhooks: WebhookTransport; chat: ChatTransport },
) {
  const clockOf = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId);

  async function load(tx: Transaction, ctx: TenantContext, id: string) {
    const subscription = await deps.subscriptions.findById(tx, ctx, id);

    if (!subscription) throw notFound("Event subscription", id);

    return subscription;
  }

  async function checkUrl(ctx: TenantContext, kind: SubscriptionKind, url: string | null) {
    if (kind !== "webhook" || !url) return;

    await deps.webhooks.assertDeliverable(
      url,
      await deps.environments.allowsPrivateUrls(ctx.tenantId),
    );
  }

  function newSecret(ctx: TenantContext, subscriptionId: string) {
    const plain = deps.secrets.generate();

    return {
      plain,
      sealed: deps.secrets.seal(plain, secretContext(ctx.tenantId, subscriptionId)),
      hint: hintOf(plain),
    };
  }

  async function loadDelivery(tx: Transaction, ctx: TenantContext, deliveryId: string) {
    const delivery = await deps.log.findDelivery(tx, ctx, deliveryId);

    if (!delivery) throw notFound("Delivery", deliveryId);

    return delivery;
  }

  return {
    async list(ctx: TenantContext, input: { kind?: SubscriptionKind } = {}) {
      const all = await deps.uow.run(ctx, (tx) => deps.subscriptions.list(tx, ctx));

      return {
        subscriptions: all
          .filter((s) => !input.kind || s.kind === input.kind)
          .map(toSubscriptionDto),
        chatProvider: await deps.chat.provider(ctx),
        sandbox: await deps.environments.isSandbox(ctx.tenantId),
      };
    },

    async get(ctx: TenantContext, input: { id: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const subscription = await load(tx, ctx, input.id);

        const deliveries = await deps.log.listDeliveries(tx, ctx, {
          subscriptionId: input.id,
          limit: 100,
        });

        return {
          subscription: toSubscriptionDto(subscription),
          deliveries: deliveries.map(toDeliveryDto),
        };
      });
    },

    async create(
      ctx: TenantContext,
      input: SubscriptionSettings & { kind: SubscriptionKind },
    ): Promise<{ id: string; secret: string | null }> {
      await checkUrl(ctx, input.kind, input.url);

      const id = newId();
      const secret = input.kind === "webhook" ? newSecret(ctx, id) : null;

      return deps.uow.run(ctx, async (tx) => {
        const subscription = Subscription.create(
          { ...input, id, tenantId: ctx.tenantId, secret, createdBy: userOf(ctx) },
          clockOf(ctx),
        );

        await deps.subscriptions.save(tx, subscription);

        return { id: subscription.id, secret: secret?.plain ?? null };
      });
    },

    async update(ctx: TenantContext, input: SubscriptionSettings & { id: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const subscription = await load(tx, ctx, input.id);
        await checkUrl(ctx, subscription.kind, input.url);
        subscription.update(input, clockOf(ctx));
        await deps.subscriptions.save(tx, subscription);

        return toSubscriptionDto(subscription);
      });
    },

    async setStatus(ctx: TenantContext, input: { id: string; active: boolean }) {
      return deps.uow.run(ctx, async (tx) => {
        const subscription = await load(tx, ctx, input.id);

        if (input.active) subscription.enable(clockOf(ctx));
        else subscription.disable(null, clockOf(ctx));

        await deps.subscriptions.save(tx, subscription);

        return toSubscriptionDto(subscription);
      });
    },

    /** The old secret keeps signing for 24 hours alongside the new one. */
    async rotateSecret(ctx: TenantContext, input: { id: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const subscription = await load(tx, ctx, input.id);
        const secret = newSecret(ctx, subscription.id);
        subscription.rotateSecret(secret, clockOf(ctx));
        await deps.subscriptions.save(tx, subscription);

        return { secret: secret.plain };
      });
    },

    async remove(ctx: TenantContext, input: { id: string }) {
      await deps.uow.run(ctx, async (tx) => {
        await load(tx, ctx, input.id);
        await deps.subscriptions.delete(tx, ctx, input.id);
      });
    },

    async delivery(ctx: TenantContext, input: { id: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const delivery = await loadDelivery(tx, ctx, input.id);
        const event = await deps.log.findEvent(tx, ctx, delivery.toSnapshot().eventId);
        const attempts = await deps.log.listAttempts(tx, ctx, delivery.id);

        return {
          delivery: toDeliveryDto(delivery),
          event: event && toEventDto(event),
          attempts: attempts.map(toAttemptDto),
        };
      });
    },

    /** Sends the same event again, signed afresh; the receiver dedupes on the event id. */
    async replay(ctx: TenantContext, input: { deliveryId: string }) {
      await deps.uow.run(ctx, async (tx) => {
        const delivery = await loadDelivery(tx, ctx, input.deliveryId);
        await load(tx, ctx, delivery.toSnapshot().subscriptionId);

        await deps.queue.enqueue(tx, {
          tenantId: ctx.tenantId,
          deliveryId: delivery.id,
          trigger: "replay",
        });
      });
    },

    /** Delivers the catalog's sample payload of one type, marked `test`, to this destination only. */
    async sendTest(ctx: TenantContext, input: { id: string; type: string }) {
      if (!isPublicEventType(input.type)) throw invalid(`${input.type} isn't an event type`);

      const type = input.type;
      const sandbox = await deps.environments.isSandbox(ctx.tenantId);

      return deps.uow.run(ctx, async (tx) => {
        const subscription = await load(tx, ctx, input.id);

        if (!subscription.toSnapshot().eventTypes.some((p) => matchesPattern(p, type))) {
          throw invalid(`${subscription.toSnapshot().name} isn't subscribed to ${type}`);
        }

        const now = clockOf(ctx).now();

        const record = buildRecord({
          draft: { type, data: catalogEntry(type).sample } as never,
          sourceEventId: `test:${now.epochMilliseconds}:${subscription.id}`,
          occurredAt: now,
          sandbox,
          test: true,
          now,
        });

        await deps.log.addEvent(tx, ctx, record);

        const delivery = Delivery.create(
          {
            tenantId: ctx.tenantId,
            subscriptionId: subscription.id,
            eventId: record.id,
            eventType: type,
          },
          clockOf(ctx),
        );

        await deps.log.addDelivery(tx, delivery);

        await deps.queue.enqueue(tx, {
          tenantId: ctx.tenantId,
          deliveryId: delivery.id,
          trigger: "test",
        });

        return { deliveryId: delivery.id };
      });
    },
  };
}

export type ManageSubscriptions = ReturnType<typeof makeManageSubscriptions>;

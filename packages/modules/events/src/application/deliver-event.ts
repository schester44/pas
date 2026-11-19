import { newId } from "@pas/kernel";
import type { Delivery } from "../domain/delivery";
import type { Subscription } from "../domain/subscription";
import type { DeliveryJob } from "../ports/delivery-queue";
import type { OutboundEventRecord } from "../ports/event-log";
import type { AdminLinks } from "../ports/platform";
import type { ChatTransport, TransportResult, WebhookTransport } from "../ports/transports";
import { catalogEntry } from "./catalog";
import { type EventsDeps, secretContext, systemContext } from "./deps";
import type { PublicEventDraft } from "./map-domain-event";

export interface DeliverDeps extends EventsDeps {
  webhooks: WebhookTransport;
  chat: ChatTransport;
  links: AdminLinks;
}

/** Runs one delivery attempt: send, log it, then retry with backoff or give up (PLAN §15.8). */
export function makeDeliverEvent(deps: DeliverDeps) {
  async function send(
    subscription: Subscription,
    delivery: Delivery,
    event: OutboundEventRecord,
  ): Promise<TransportResult> {
    const s = subscription.toSnapshot();
    const ctx = systemContext(s.tenantId);

    if (s.kind === "chat") {
      const entry = catalogEntry(event.type as PublicEventDraft["type"]);
      const message = entry.message(event.envelope.data as never);

      return deps.chat.post(ctx, {
        ...message,
        link: deps.links.url(event.subject),
        eventType: event.type,
        test: event.test,
      });
    }

    const now = deps.clocks.forTenant(s.tenantId).now();

    const secrets = subscription
      .signingSecrets(now)
      .map((sealed) => deps.secrets.open(sealed, secretContext(s.tenantId, s.id)));

    return deps.webhooks.send({
      url: s.url!,
      body: JSON.stringify(event.envelope),
      secrets,
      headers: {
        "pas-event-id": event.envelope.id,
        "pas-event-type": event.type,
        "pas-delivery-id": delivery.id,
        "pas-delivery-attempt": String(delivery.attempts + 1),
        "idempotency-key": event.envelope.id,
      },
      allowPrivate: await deps.environments.allowsPrivateUrls(s.tenantId),
    });
  }

  return async function deliverEvent(job: DeliveryJob): Promise<{ status: string }> {
    const ctx = systemContext(job.tenantId);
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const loaded = await deps.uow.run(ctx, async (tx) => {
      const delivery = await deps.log.findDelivery(tx, ctx, job.deliveryId);

      if (!delivery) return null;

      const d = delivery.toSnapshot();

      const [subscription, event] = await Promise.all([
        deps.subscriptions.findById(tx, ctx, d.subscriptionId),
        deps.log.findEvent(tx, ctx, d.eventId),
      ]);

      if (job.trigger === "automatic" && (!subscription?.isActive || !event)) {
        delivery.cancel(clock);
        await deps.log.saveDelivery(tx, delivery);

        return null;
      }

      return subscription && event ? { delivery, subscription, event } : null;
    });

    if (!loaded) return { status: "skipped" };

    if (job.trigger === "automatic" && !loaded.delivery.waiting) return { status: "done" };

    const result = await send(loaded.subscription, loaded.delivery, loaded.event).catch(
      (error: unknown): TransportResult => ({
        ok: false,
        statusCode: null,
        responseBody: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        request: { url: loaded.subscription.toSnapshot().url ?? "", headers: {} },
      }),
    );

    return deps.uow.run(ctx, async (tx) => {
      const delivery = (await deps.log.findDelivery(tx, ctx, job.deliveryId))!;

      const subscription = (await deps.subscriptions.findById(
        tx,
        ctx,
        delivery.toSnapshot().subscriptionId,
      ))!;

      const delay = delivery.recordAttempt(
        { ok: result.ok, statusCode: result.statusCode },
        job.trigger,
        clock,
      );

      await deps.log.addAttempt(tx, ctx, {
        id: newId(),
        deliveryId: delivery.id,
        attempt: delivery.attempts,
        trigger: job.trigger,
        request: result.request,
        statusCode: result.statusCode,
        responseBody: result.responseBody,
        error: result.error,
        durationMs: result.durationMs,
        attemptedAt: clock.now(),
      });

      await deps.log.saveDelivery(tx, delivery);

      if (result.ok) subscription.recordSuccess(clock);
      else subscription.recordFailure(clock);

      if (!result.ok && job.trigger === "automatic" && !delay) subscription.exhausted(clock);

      await deps.subscriptions.save(tx, subscription);
      await deps.outbox.add(tx, subscription.pullEvents());

      if (delay && subscription.isActive) await deps.queue.enqueue(tx, job, delay);

      return { status: delivery.toSnapshot().status };
    });
  };
}

export type DeliverEvent = ReturnType<typeof makeDeliverEvent>;

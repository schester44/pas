import { invalid, newId, notFound, type TenantContext, workflowRef } from "@pas/kernel";
import { assertFeed, type Feed, type FeedDelivery, feedPeriod } from "../domain/feed";
import { feedFile } from "../domain/feed-files";
import type { CarrierDeps } from "./deps";
import { toFeedDto } from "./dto";
import { loadCarrier } from "./manage-carriers";

export const carrierFeedWorkflow = workflowRef<{ feedId: string }>("carrier.feed", {
  parse(value) {
    const id = (value as { feedId?: unknown } | null)?.feedId;

    if (typeof id !== "string") throw invalid("carrier.feed needs a feedId");

    return { feedId: id };
  },
});

export type FeedInput = Pick<
  Feed,
  "name" | "format" | "channel" | "destination" | "schedule" | "status"
>;

/** File feeds for carriers without an API (PLAN §12 "no API"): generate, deliver, log. */
export function makeFeeds(
  deps: CarrierDeps & { senderName: (ctx: TenantContext) => Promise<string> },
) {
  const now = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId).now();

  const list = (ctx: TenantContext, input: { carrierId: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const feeds = await deps.feeds.list(tx, ctx, input.carrierId);

      return Promise.all(
        feeds.map(async (feed) =>
          toFeedDto(feed, await deps.feeds.deliveries(tx, ctx, feed.id, 20)),
        ),
      );
    });

  const save = async (
    ctx: TenantContext,
    input: FeedInput & { carrierId: string; id?: string },
  ) => {
    const feed = await deps.uow.run(ctx, async (tx) => {
      const carrier = await loadCarrier(deps, tx, ctx, input.carrierId);
      const existing = input.id ? await deps.feeds.findById(tx, ctx, input.id) : null;

      const next: Feed = {
        id: existing?.id ?? newId(),
        carrierId: carrier.id,
        name: input.name.trim(),
        format: input.format,
        channel: input.channel,
        destination: input.destination,
        schedule: input.schedule,
        status: input.status,
        lastRunAt: existing?.lastRunAt ?? null,
        createdAt: existing?.createdAt ?? now(ctx),
        updatedAt: now(ctx),
      };

      assertFeed(next);
      await deps.feeds.save(tx, ctx, next);

      return next;
    });

    await deps
      .workflows()
      .start(
        ctx,
        carrierFeedWorkflow,
        { feedId: feed.id },
        { idempotencyKey: `carrier.feed:${feed.id}` },
      );

    return toFeedDto(feed, []);
  };

  const run = async (ctx: TenantContext, input: { feedId: string; now?: boolean }) => {
    const { feed, carrier } = await deps.uow.run(ctx, async (tx) => {
      const found = await deps.feeds.findById(tx, ctx, input.feedId);

      if (!found) throw notFound("Feed", input.feedId);

      return { feed: found, carrier: await loadCarrier(deps, tx, ctx, found.carrierId) };
    });

    const period = feedPeriod(feed.schedule, deps.clocks.forTenant(ctx.tenantId).today("UTC"), {
      includeToday: input.now ?? false,
    });

    const range = { from: period.from.toString(), to: period.to.toString() };
    const records = await deps.feedSource.records(ctx, { carrierKey: carrier.key, ...range });

    const file = feedFile(feed.format, records, {
      sender: await deps.senderName(ctx),
      carrier: carrier.name,
      carrierKey: carrier.key,
      period: range,
    });

    const body = new TextEncoder().encode(file.body);
    const key = `tenants/${ctx.tenantId}/carriers/${carrier.id}/feeds/${feed.id}/${newId()}-${file.fileName}`;

    await deps.storage.put({ key, body, contentType: file.contentType });

    let status: FeedDelivery["status"] = "delivered";
    let detail: string;

    try {
      detail = (
        await deps.feedChannels.deliver(ctx, {
          channel: feed.channel,
          destination: feed.destination,
          file: { fileName: file.fileName, contentType: file.contentType, body },
          subject: `${carrier.name} ${feed.format === "bordereaux_csv" ? "bordereau" : "transactions"} ${range.from} – ${range.to}`,
        })
      ).detail;
    } catch (error) {
      status = "failed";
      detail = error instanceof Error ? error.message : String(error);
    }

    const delivery: FeedDelivery = {
      id: newId(),
      feedId: feed.id,
      periodFrom: period.from,
      periodTo: period.to,
      status,
      fileName: file.fileName,
      storageKey: key,
      records: records.length,
      bytes: body.byteLength,
      channel: feed.channel,
      detail,
      deliveredAt: now(ctx),
    };

    await deps.uow.run(ctx, async (tx) => {
      await deps.feeds.recordDelivery(tx, ctx, delivery);
      await deps.feeds.save(tx, ctx, { ...feed, lastRunAt: now(ctx), updatedAt: now(ctx) });
    });

    return { status, records: records.length, fileName: file.fileName, detail };
  };

  /** For the feed workflow: the schedule's wait, or null once the feed is gone or paused. */
  const schedule = (ctx: TenantContext, input: { feedId: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const feed = await deps.feeds.findById(tx, ctx, input.feedId);

      if (!feed || feed.status !== "active") return null;

      return feed.schedule === "daily"
        ? { days: 1 }
        : feed.schedule === "weekly"
          ? { days: 7 }
          : { days: 30 };
    });

  const download = (ctx: TenantContext, input: { feedId: string; deliveryId: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const delivery = (await deps.feeds.deliveries(tx, ctx, input.feedId, 200)).find(
        (d) => d.id === input.deliveryId,
      );

      if (!delivery?.storageKey) throw notFound("Feed delivery", input.deliveryId);

      const file = await deps.storage.get(delivery.storageKey);

      if (!file) throw notFound("Feed file", delivery.fileName);

      return {
        fileName: delivery.fileName,
        contentType: file.contentType,
        text: new TextDecoder().decode(file.body),
      };
    });

  return { list, save, run, schedule, download };
}

export type Feeds = ReturnType<typeof makeFeeds>;

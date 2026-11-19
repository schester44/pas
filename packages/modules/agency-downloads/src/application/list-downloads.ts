import { notFound, type TenantContext } from "@pas/kernel";
import { nextRunDate, runInstant } from "../domain/schedule";
import type { AgencyDownloadsDeps } from "./deps";
import {
  type DownloadBatchDto,
  type DownloadItemDto,
  toBatchDto,
  toEnrollmentDto,
  toItemDto,
} from "./dto";

const PREVIEW_BYTES = 512 * 1024;

/** Distribution → Downloads: what's waiting, what went out, and each agency's mailbox. */
export function makeListDownloads(deps: AgencyDownloadsDeps) {
  const names = async (ctx: TenantContext) =>
    new Map((await deps.agencies.agencies(ctx)).map((a) => [a.id, a.name]));

  async function provider(ctx: TenantContext) {
    const channel = await deps.channels.active(ctx);

    if (!channel) return null;

    const now = deps.clocks.forTenant(ctx.tenantId).now();
    const runDate = nextRunDate(now, channel.settings);

    return {
      id: channel.provider,
      name: channel.name,
      transport: channel.transport,
      test: channel.test,
      format: channel.settings.format,
      certified: deps.formats[channel.settings.format]?.certified ?? false,
      batchTime: channel.settings.batchTime,
      timeZone: channel.settings.timeZone,
      transactionKinds: [...channel.settings.transactionKinds],
      documents: channel.settings.documents,
      commissionStatements: channel.settings.commissionStatements,
      nextRunDate: runDate.toString(),
      nextRunAt: runInstant(runDate, channel.settings).toString(),
    };
  }

  return {
    async overview(ctx: TenantContext) {
      const [agencyNames, active] = await Promise.all([names(ctx), provider(ctx)]);
      const name = (id: string) => agencyNames.get(id) ?? "";

      const { enrollments, pending, recent, batches } = await deps.uow.run(ctx, async (tx) => ({
        enrollments: await deps.enrollments.list(tx, ctx),
        pending: await deps.items.list(tx, ctx, { status: "pending", limit: 300 }),
        recent: await deps.items.list(tx, ctx, { status: "delivered", limit: 100 }),
        batches: await deps.batches.list(tx, ctx, { limit: 200 }),
      }));

      const mailboxes = enrollments.map((e) => {
        const delivered = batches.filter(
          (b) => b.agencyId === e.agencyId && b.status === "delivered",
        );

        return {
          ...toEnrollmentDto(e, name(e.agencyId)),
          pending: pending.filter((i) => i.agencyId === e.agencyId).length,
          files: delivered.length,
          lastDeliveredAt: delivered[0]?.deliveredAt?.toString() ?? null,
        };
      });

      return {
        provider: active,
        mailboxes: mailboxes.toSorted((a, b) => a.agencyName.localeCompare(b.agencyName)),
        pending: pending.map((i) => toItemDto(i, name(i.agencyId))),
        delivered: recent.map((i) => toItemDto(i, name(i.agencyId))),
        batches: batches.map((b) => toBatchDto(b, name(b.agencyId))),
      };
    },

    async agency(ctx: TenantContext, input: { agencyId: string }) {
      const agencyNames = await names(ctx);
      const name = agencyNames.get(input.agencyId) ?? "";

      const { enrollment, items, batches } = await deps.uow.run(ctx, async (tx) => ({
        enrollment: await deps.enrollments.findByAgency(tx, ctx, input.agencyId),
        items: await deps.items.list(tx, ctx, { agencyId: input.agencyId, limit: 100 }),
        batches: await deps.batches.list(tx, ctx, { agencyId: input.agencyId, limit: 50 }),
      }));

      return {
        provider: await provider(ctx),
        enrollment: enrollment && toEnrollmentDto(enrollment, name),
        items: items.map((i) => toItemDto(i, name)),
        batches: batches.map((b) => toBatchDto(b, name)),
      };
    },

    async batch(
      ctx: TenantContext,
      input: { id: string },
    ): Promise<{
      batch: DownloadBatchDto;
      items: DownloadItemDto[];
      preview: string;
      truncated: boolean;
    }> {
      const agencyNames = await names(ctx);

      const { batch, items } = await deps.uow.run(ctx, async (tx) => {
        const found = await deps.batches.findById(tx, ctx, input.id);

        if (!found) throw notFound("Download batch", input.id);

        return { batch: found, items: await deps.items.list(tx, ctx, { ids: found.itemIds }) };
      });

      const file = await deps.storage.get(batch.fileKey);
      const body = file?.body ?? new Uint8Array();
      const name = agencyNames.get(batch.agencyId) ?? "";

      return {
        batch: toBatchDto(batch, name),
        items: items.map((i) => toItemDto(i, name)),
        preview: new TextDecoder().decode(body.subarray(0, PREVIEW_BYTES)),
        truncated: body.byteLength > PREVIEW_BYTES,
      };
    },

    async file(ctx: TenantContext, input: { id: string }) {
      const batch = await deps.uow.run(ctx, (tx) => deps.batches.findById(tx, ctx, input.id));

      if (!batch) throw notFound("Download batch", input.id);

      const file = await deps.storage.get(batch.fileKey);

      if (!file) throw notFound("Download file", input.id);

      return { fileName: batch.fileName, contentType: batch.contentType, body: file.body };
    },

    async item(ctx: TenantContext, input: { id: string }) {
      const item = await deps.uow.run(ctx, (tx) => deps.items.findById(tx, ctx, input.id));

      if (!item) throw notFound("Download item", input.id);

      const agencyNames = await names(ctx);

      return { ...toItemDto(item, agencyNames.get(item.agencyId) ?? ""), record: item.record };
    },

    async forPolicy(ctx: TenantContext, input: { policyId: string }) {
      const agencyNames = await names(ctx);

      const items = await deps.uow.run(ctx, (tx) =>
        deps.items.list(tx, ctx, { policyId: input.policyId }),
      );

      return items.map((i) => toItemDto(i, agencyNames.get(i.agencyId) ?? ""));
    },
  };
}

export type ListDownloads = ReturnType<typeof makeListDownloads>;

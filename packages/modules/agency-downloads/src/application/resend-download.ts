import { newId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import type { AgencyDownloadsDeps } from "./deps";
import { buildFile, deliverFile } from "./deliver";
import { activeChannel } from "./send-commission-statement";

const outcome = (batch: { id: string; status: string; error: string | null }) => ({
  batchId: batch.id,
  status: batch.status,
  error: batch.error,
});

/** Resends what an agency asked for again (through IVANS Exchange): one batch file, or one item. */
export function makeResendDownload(deps: AgencyDownloadsDeps) {
  async function enrollmentOf(tx: Transaction, ctx: TenantContext, agencyId: string) {
    const enrollment = await deps.enrollments.findByAgency(tx, ctx, agencyId);

    if (!enrollment) throw notFound("Agency download enrollment", agencyId);

    return enrollment;
  }

  return {
    /** The same file again, byte for byte, as a new delivery. */
    async batch(ctx: TenantContext, input: { batchId: string }) {
      const channel = await activeChannel(deps, ctx);

      const { original, enrollment, items } = await deps.uow.run(ctx, async (tx) => {
        const found = await deps.batches.findById(tx, ctx, input.batchId);

        if (!found) throw notFound("Download batch", input.batchId);

        return {
          original: found,
          enrollment: await enrollmentOf(tx, ctx, found.agencyId),
          items: await deps.items.list(tx, ctx, { ids: found.itemIds }),
        };
      });

      const stored = await deps.storage.get(original.fileKey);

      if (!stored) throw notFound("Download file", original.id);

      const batch = await deliverFile(deps, ctx, channel, {
        agencyId: original.agencyId,
        kind: original.kind,
        enrollment,
        items,
        file: {
          fileId: newId(),
          fileName: original.fileName,
          contentType: original.contentType,
          body: stored.body,
          format: original.format,
        },
        trigger: "resend_batch",
        runKey: null,
        resendOf: original.id,
      });

      return outcome(batch);
    },

    /** A fresh file with just this item, built from its stored record. */
    async item(ctx: TenantContext, input: { itemId: string }) {
      const channel = await activeChannel(deps, ctx);

      const { item, enrollment } = await deps.uow.run(ctx, async (tx) => {
        const found = await deps.items.findById(tx, ctx, input.itemId);

        if (!found) throw notFound("Download item", input.itemId);

        return { item: found, enrollment: await enrollmentOf(tx, ctx, found.agencyId) };
      });

      const group = { kind: item.kind, enrollment, items: [item] };
      const file = await buildFile(deps, ctx, channel, group);

      const batch = await deliverFile(deps, ctx, channel, {
        ...group,
        agencyId: item.agencyId,
        file,
        trigger: "resend_item",
        runKey: null,
        ...(item.batchId && { resendOf: item.batchId }),
      });

      return outcome(batch);
    },
  };
}

export type ResendDownload = ReturnType<typeof makeResendDownload>;

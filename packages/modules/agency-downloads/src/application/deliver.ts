import { type DomainEvent, newId, type TenantContext } from "@pas/kernel";
import type { Enrollment } from "../domain/enrollment";
import type { BatchTrigger, DownloadBatch, DownloadItem, ItemKind } from "../domain/item";
import type { DownloadRecord } from "../domain/record";
import type { CommissionStatementRecord } from "../domain/statement";
import type { AgencyDownloadChannel } from "../ports/channel";
import type { Attachment, DownloadFormat, FileEnvelope } from "../ports/format";
import { type AgencyDownloadsDeps, obligationKey } from "./deps";

export interface FileToDeliver {
  fileId: string;
  fileName: string;
  contentType: string;
  body: Uint8Array;
  format: string;
}

export function formatFor(deps: Pick<AgencyDownloadsDeps, "formats">, id: string): DownloadFormat {
  const format = deps.formats[id];

  if (!format) throw new Error(`Unknown download format ${id}`);

  return format;
}

const stamp = (iso: string) => iso.slice(0, 10).replaceAll("-", "");

/** Serializes a group of items into one mailbox file. */
export async function buildFile(
  deps: Pick<AgencyDownloadsDeps, "formats" | "clocks" | "transactions" | "tenantName">,
  ctx: TenantContext,
  channel: AgencyDownloadChannel,
  input: { kind: ItemKind; enrollment: Enrollment; items: readonly DownloadItem[] },
): Promise<FileToDeliver> {
  const format = formatFor(deps, channel.settings.format);
  const fileId = newId();
  const createdAt = deps.clocks.forTenant(ctx.tenantId).now();

  const envelope: FileEnvelope = {
    fileId,
    createdAt,
    sender: { participantCode: channel.settings.participantCode, name: await deps.tenantName(ctx) },
    recipient: { accountCode: input.enrollment.accountCode, mailbox: input.enrollment.mailbox },
    test: channel.test,
  };

  const content =
    input.kind === "commission_statement"
      ? format.commissionFile(envelope, input.items[0]!.record as CommissionStatementRecord)
      : format.policyFile(
          envelope,
          input.items.map((i) => i.record as DownloadRecord),
          channel.settings.documents ? await attachmentsOf(deps, ctx, input.items) : [],
        );

  const prefix = input.kind === "commission_statement" ? "DBCS" : "POL";

  return {
    fileId,
    fileName: `${input.enrollment.accountCode}-${prefix}-${stamp(createdAt.toString())}-${fileId.slice(-6)}.${format.extension}`,
    contentType: format.contentType,
    body: new TextEncoder().encode(content),
    format: format.id,
  };
}

async function attachmentsOf(
  deps: Pick<AgencyDownloadsDeps, "transactions">,
  ctx: TenantContext,
  items: readonly DownloadItem[],
): Promise<Attachment[]> {
  const attachments: Attachment[] = [];

  for (const item of items) {
    const record = item.record as DownloadRecord;

    for (const document of record.documents) {
      const file = await deps.transactions.document(ctx, {
        policyId: record.policy.id,
        documentId: document.id,
      });

      attachments.push({
        transactionId: record.transaction.id,
        documentId: document.id,
        fileName: file.fileName,
        contentType: "application/pdf",
        body: file.body,
      });
    }
  }

  return attachments;
}

/**
 * Stores the file, hands it to the transport and records the batch. A failed delivery leaves its
 * items pending for the next batch; a delivered one meets each item's obligation.
 */
export async function deliverFile(
  deps: AgencyDownloadsDeps,
  ctx: TenantContext,
  channel: AgencyDownloadChannel,
  input: {
    agencyId: string;
    kind: ItemKind;
    enrollment: Enrollment;
    items: readonly DownloadItem[];
    file: FileToDeliver;
    trigger: BatchTrigger;
    runKey: string | null;
    resendOf?: string;
  },
): Promise<DownloadBatch> {
  const { file } = input;
  const key = `agency-downloads/${ctx.tenantId}/${file.fileId}/${file.fileName}`;

  await deps.storage.put({ key, body: file.body, contentType: file.contentType });

  let reference: string | null = null;
  let error: string | null = null;

  try {
    ({ reference } = await channel.deliver(ctx, {
      fileId: file.fileId,
      accountCode: input.enrollment.accountCode,
      mailbox: input.enrollment.mailbox,
      fileName: file.fileName,
      contentType: file.contentType,
      body: file.body,
      itemCount: input.items.length,
    }));
  } catch (cause) {
    error = (cause as Error).message;
  }

  const now = deps.clocks.forTenant(ctx.tenantId).now();
  const delivered = error === null;

  const batch: DownloadBatch = {
    id: file.fileId,
    tenantId: ctx.tenantId,
    agencyId: input.agencyId,
    runKey: delivered && input.runKey ? input.runKey : `${input.trigger}:${file.fileId}`,
    kind: input.kind,
    trigger: input.trigger,
    accountCode: input.enrollment.accountCode,
    mailbox: input.enrollment.mailbox,
    format: file.format,
    providerId: channel.provider,
    transport: channel.transport,
    status: delivered ? "delivered" : "failed",
    fileName: file.fileName,
    fileKey: key,
    contentType: file.contentType,
    sizeBytes: file.body.byteLength,
    itemIds: input.items.map((i) => i.id),
    reference,
    error,
    resendOf: input.resendOf ?? null,
    createdAt: now,
    deliveredAt: delivered ? now : null,
  };

  const event: DomainEvent = {
    id: newId(),
    type: delivered ? "agency_downloads.batch_delivered" : "agency_downloads.batch_failed",
    tenantId: ctx.tenantId,
    aggregateType: "agency_download_batch",
    aggregateId: batch.id,
    occurredAt: now,
    payload: {
      batchId: batch.id,
      agencyId: batch.agencyId,
      kind: batch.kind,
      itemCount: batch.itemIds.length,
      ...(error && { error }),
    },
  };

  await deps.uow.run(ctx, async (tx) => {
    await deps.batches.save(tx, batch);

    for (const item of input.items) {
      const current = (await deps.items.findById(tx, ctx, item.id)) ?? item;

      await deps.items.save(tx, {
        ...current,
        attempts: current.attempts + 1,
        ...(delivered
          ? { status: "delivered", batchId: batch.id, deliveredAt: now, lastError: null }
          : { lastError: error }),
      });
    }

    await deps.outbox.add(tx, [event]);
  });

  if (delivered) {
    for (const item of input.items.filter((i) => i.obligationId)) {
      await deps.obligations.settle(ctx, {
        dedupeKey: obligationKey(item.dedupeKey),
        providerId: channel.provider,
        reference: reference ?? batch.id,
      });
    }
  }

  return batch;
}

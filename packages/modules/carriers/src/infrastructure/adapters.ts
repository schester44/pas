import type { TenantContext } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { PDFDocument } from "pdf-lib";
import type { FeedChannels, FeedFile } from "../ports/services";
import type { FeedChannel, FeedDestination } from "../domain/feed";

/**
 * Extension adapters (PLAN §12 option 2) register here. The sandboxed extension runtime
 * (§15.1) isn't built yet, so only adapters passed in by a composition root are listed.
 */
const MAX_INLINE = 200_000;

/**
 * SFTP is faked (files land in object storage under `sftp/`); email sends the file inline.
 * A real SFTP adapter replaces `sftp` without touching feeds.
 */
export class FeedDeliveryChannels implements FeedChannels {
  constructor(
    private readonly deps: {
      storage: ObjectStorage;
      sendEmail: (
        ctx: TenantContext,
        message: { to: string; subject: string; text: string; tag: string },
      ) => Promise<void>;
    },
  ) {}

  async deliver(
    ctx: TenantContext,
    input: { channel: FeedChannel; destination: FeedDestination; file: FeedFile; subject: string },
  ) {
    if (input.channel === "sftp") {
      const host = input.destination.host ?? "sftp";
      const folder = (input.destination.path ?? "/").replace(/^\/+|\/+$/g, "");
      const key = `tenants/${ctx.tenantId}/sftp/${host}/${folder ? `${folder}/` : ""}${input.file.fileName}`;

      await this.deps.storage.put({
        key,
        body: input.file.body,
        contentType: input.file.contentType,
      });

      return {
        detail: `Uploaded to sftp://${host}/${folder ? `${folder}/` : ""}${input.file.fileName} (fake SFTP)`,
      };
    }

    const text = new TextDecoder().decode(input.file.body);

    await this.deps.sendEmail(ctx, {
      to: input.destination.email!,
      subject: input.subject,
      tag: "carrier_feed",
      text:
        text.length > MAX_INLINE
          ? `${input.file.fileName} is ${input.file.body.byteLength} bytes; download it from the carrier's feed log.`
          : `${input.file.fileName}\n\n${text}`,
    });

    return { detail: `Emailed ${input.file.fileName} to ${input.destination.email}` };
  }
}

/** Joins PDFs into one packet in the given order. */
export async function mergePdfs(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const part of parts) {
    const source = await PDFDocument.load(part, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());

    for (const page of pages) merged.addPage(page);
  }

  return merged.save();
}

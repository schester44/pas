import type { Instant } from "@pas/kernel";
import type { DownloadRecord } from "../domain/record";
import type { DownloadFormatId } from "../domain/settings";
import type { CommissionStatementRecord } from "../domain/statement";

export interface FileEnvelope {
  fileId: string;
  createdAt: Instant;
  sender: { participantCode: string; name: string };
  recipient: { accountCode: string; mailbox: string | null };
  test: boolean;
}

export interface Attachment {
  transactionId: string;
  documentId: string;
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

/** Serializes canonical records into one mailbox file (ACORD XML, AL3, …). */
export interface DownloadFormat {
  readonly id: DownloadFormatId;
  readonly label: string;
  readonly extension: string;
  readonly contentType: string;
  /** False until the format is certified against the standard's specification. */
  readonly certified: boolean;
  policyFile(
    envelope: FileEnvelope,
    records: readonly DownloadRecord[],
    attachments: readonly Attachment[],
  ): string;
  commissionFile(envelope: FileEnvelope, statement: CommissionStatementRecord): string;
}

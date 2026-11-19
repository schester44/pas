import type { Instant, PlainDate, TenantId } from "@pas/kernel";
import type { DownloadRecord } from "./record";
import type { CommissionStatementRecord } from "./statement";

export const ITEM_KINDS = ["policy", "commission_statement"] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATUSES = ["pending", "delivered"] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** One thing owed to an agency's mailbox. Failed deliveries stay pending for the next batch. */
export interface DownloadItem {
  id: string;
  tenantId: TenantId;
  agencyId: string;
  kind: ItemKind;
  dedupeKey: string;
  status: ItemStatus;
  policyId: string | null;
  policyNumber: string | null;
  transactionId: string | null;
  transactionType: string | null;
  effectiveDate: PlainDate | null;
  title: string;
  record: DownloadRecord | CommissionStatementRecord;
  batchId: string | null;
  attempts: number;
  lastError: string | null;
  obligationId: string | null;
  createdAt: Instant;
  deliveredAt: Instant | null;
}

export const policyItemKey = (transactionId: string) => `transaction:${transactionId}`;

export const statementItemKey = (agencyId: string, from: PlainDate) =>
  `commission:${agencyId}:${from.toString()}`;

export const BATCH_TRIGGERS = ["scheduled", "resend_batch", "resend_item", "manual"] as const;

export type BatchTrigger = (typeof BATCH_TRIGGERS)[number];

/** One file delivered (or attempted) to one agency mailbox. */
export interface DownloadBatch {
  id: string;
  tenantId: TenantId;
  agencyId: string;
  runKey: string;
  kind: ItemKind;
  trigger: BatchTrigger;
  accountCode: string;
  mailbox: string | null;
  format: string;
  providerId: string;
  transport: string;
  status: "delivered" | "failed";
  fileName: string;
  fileKey: string;
  contentType: string;
  sizeBytes: number;
  itemIds: string[];
  reference: string | null;
  error: string | null;
  resendOf: string | null;
  createdAt: Instant;
  deliveredAt: Instant | null;
}

import type { Enrollment } from "../domain/enrollment";
import type { DownloadBatch, DownloadItem } from "../domain/item";

export interface EnrollmentDto {
  id: string;
  agencyId: string;
  agencyName: string;
  accountCode: string;
  mailbox: string | null;
  agencyCodes: { carrier: string; code: string }[];
  enabled: boolean;
  startDate: string;
  updatedAt: string;
}

export interface DownloadItemDto {
  id: string;
  agencyId: string;
  agencyName: string;
  kind: DownloadItem["kind"];
  status: DownloadItem["status"];
  title: string;
  policyId: string | null;
  policyNumber: string | null;
  transactionType: string | null;
  effectiveDate: string | null;
  batchId: string | null;
  attempts: number;
  lastError: string | null;
  obligationId: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface DownloadBatchDto {
  id: string;
  agencyId: string;
  agencyName: string;
  kind: DownloadBatch["kind"];
  trigger: DownloadBatch["trigger"];
  accountCode: string;
  mailbox: string | null;
  format: string;
  providerId: string;
  transport: string;
  status: DownloadBatch["status"];
  fileName: string;
  sizeBytes: number;
  itemCount: number;
  reference: string | null;
  error: string | null;
  resendOf: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export const toEnrollmentDto = (e: Enrollment, agencyName: string): EnrollmentDto => ({
  id: e.id,
  agencyId: e.agencyId,
  agencyName,
  accountCode: e.accountCode,
  mailbox: e.mailbox,
  agencyCodes: e.agencyCodes,
  enabled: e.enabled,
  startDate: e.startDate.toString(),
  updatedAt: e.updatedAt.toString(),
});

export const toItemDto = (i: DownloadItem, agencyName: string): DownloadItemDto => ({
  id: i.id,
  agencyId: i.agencyId,
  agencyName,
  kind: i.kind,
  status: i.status,
  title: i.title,
  policyId: i.policyId,
  policyNumber: i.policyNumber,
  transactionType: i.transactionType,
  effectiveDate: i.effectiveDate?.toString() ?? null,
  batchId: i.batchId,
  attempts: i.attempts,
  lastError: i.lastError,
  obligationId: i.obligationId,
  createdAt: i.createdAt.toString(),
  deliveredAt: i.deliveredAt?.toString() ?? null,
});

export const toBatchDto = (b: DownloadBatch, agencyName: string): DownloadBatchDto => ({
  id: b.id,
  agencyId: b.agencyId,
  agencyName,
  kind: b.kind,
  trigger: b.trigger,
  accountCode: b.accountCode,
  mailbox: b.mailbox,
  format: b.format,
  providerId: b.providerId,
  transport: b.transport,
  status: b.status,
  fileName: b.fileName,
  sizeBytes: b.sizeBytes,
  itemCount: b.itemIds.length,
  reference: b.reference,
  error: b.error,
  resendOf: b.resendOf,
  createdAt: b.createdAt.toString(),
  deliveredAt: b.deliveredAt?.toString() ?? null,
});

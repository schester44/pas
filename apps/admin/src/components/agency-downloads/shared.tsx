import { StatusChip } from "@pas/ui/components/status-chip";
import type { AdminOutputs } from "@pas/api-client";

type Outputs = AdminOutputs["agencyDownloads"];

export type DownloadsOverview = Outputs["overview"];
export type DownloadItem = DownloadsOverview["pending"][number];
export type DownloadBatch = DownloadsOverview["batches"][number];
export type Enrollment = Outputs["enrollments"][number];
export type DownloadsProvider = NonNullable<DownloadsOverview["provider"]>;

export const TRANSACTION_LABELS: Record<string, string> = {
  NEW_BUSINESS: "New business",
  ENDORSEMENT: "Endorsement",
  CANCELLATION: "Cancellation",
  CANCELLATION_RESCISSION: "Reinstatement",
  REINSTATEMENT: "Reinstatement",
  RENEWAL: "Renewal",
};

export const KIND_LABELS: Record<string, string> = {
  new_business: "new business",
  endorsement: "endorsements",
  cancellation: "cancellations",
  reinstatement: "reinstatements",
  renewal: "renewals",
};

export const FORMAT_LABELS: Record<string, string> = {
  acord_xml: "ACORD XML",
  al3: "ACORD AL3 (placeholder)",
};

export const TRIGGER_LABELS: Record<string, string> = {
  scheduled: "Nightly batch",
  resend_batch: "Resent file",
  resend_item: "Resent transaction",
  manual: "Sent now",
};

export function BatchStatus({ status }: { status: string }) {
  return status === "delivered" ? (
    <StatusChip tone="success">Delivered</StatusChip>
  ) : (
    <StatusChip tone="danger">Failed</StatusChip>
  );
}

export function ItemStatus({
  item,
}: {
  item: Pick<DownloadItem, "status" | "lastError" | "attempts">;
}) {
  if (item.status === "delivered") return <StatusChip tone="success">Delivered</StatusChip>;

  if (item.attempts > 0) return <StatusChip tone="danger">Retrying</StatusChip>;

  return <StatusChip tone="neutral">Pending</StatusChip>;
}

export const mailboxOf = (b: { accountCode: string; mailbox: string | null }) =>
  b.mailbox ? `${b.accountCode} · ${b.mailbox}` : b.accountCode;

export const fileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function saveFile(fileName: string, contentType: string, body: BlobPart) {
  const url = URL.createObjectURL(new Blob([body], { type: contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

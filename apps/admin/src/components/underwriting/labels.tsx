import type { AdminOutputs } from "@pas/api-client";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";

export type ReferralSummary = AdminOutputs["underwriting"]["queue"]["items"][number];
export type ReferralDetail = AdminOutputs["underwriting"]["referral"];
export type Subjectivity = AdminOutputs["underwriting"]["subjectivities"]["forQuote"][number];
export type Inspection = AdminOutputs["underwriting"]["inspections"]["get"];

const REFERRAL: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "In queue", tone: "warning" },
  escalated: { label: "Escalated", tone: "danger" },
  info_requested: { label: "Waiting on producer", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
};

const SUBJECTIVITY: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "warning" },
  received: { label: "Received", tone: "accent" },
  accepted: { label: "Accepted", tone: "success" },
  waived: { label: "Waived", tone: "neutral" },
};

const INSPECTION: Record<string, { label: string; tone: StatusTone }> = {
  requested: { label: "Requested", tone: "neutral" },
  ordered: { label: "Ordered", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "accent" },
  completed: { label: "Needs review", tone: "warning" },
  reviewed: { label: "Reviewed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const chip = (map: typeof REFERRAL, status: string) => {
  const { label, tone } = map[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
};

export const ReferralStatus = ({ status }: { status: string }) => chip(REFERRAL, status);

export const SubjectivityStatus = ({ status, overdue }: { status: string; overdue?: boolean }) =>
  overdue && status === "open" ? (
    <StatusChip tone="danger">Overdue</StatusChip>
  ) : (
    chip(SUBJECTIVITY, status)
  );

export const InspectionStatus = ({ status }: { status: string }) => chip(INSPECTION, status);

export const INSPECTION_TYPES: Record<string, string> = {
  exterior: "Exterior inspection",
  interior_exterior: "Interior and exterior inspection",
  aerial: "Aerial imagery review",
  field: "Field inspection",
};

export const OWNERS: Record<string, string> = {
  producer: "Producer",
  insured: "Insured",
  underwriter: "Underwriter",
};

export const TIMINGS: Record<string, string> = {
  pre_bind: "Before binding",
  post_bind: "After binding",
};

/** Hours (or days) between two instants, as a short age like "5h" or "3d". */
export function age(from: string, now: string): string {
  const hours = Math.max(0, (Date.parse(now) - Date.parse(from)) / 3_600_000);

  return hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`;
}

export async function downloadBase64(file: {
  fileName: string;
  contentType: string;
  base64: string;
}) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement("a");

  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

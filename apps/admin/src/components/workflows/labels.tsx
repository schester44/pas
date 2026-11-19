import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";

export const WORKFLOWS: Record<string, string> = {
  "policy.term": "Term effective date",
  "policy.cancellation": "Scheduled cancellation",
  "billing.installment": "Installment",
  "billing.mortgagee_bill": "Mortgagee bill",
  "billing.agency_account": "Agency account current",
  "compliance.obligation": "Compliance obligation",
  "compliance.filing": "Filing answer",
  "underwriting.inspection": "Inspection",
  "underwriting.subjectivity": "Subjectivity",
  "quote.journey": "Quote journey",
  "demo.approval": "Approval demo",
};

export const workflowName = (id: string) => WORKFLOWS[id] ?? id;

export const RUN_STATUSES = [
  "waiting",
  "running",
  "pending",
  "failed",
  "completed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

const TONE: Record<RunStatus, StatusTone> = {
  waiting: "accent",
  running: "accent",
  pending: "neutral",
  failed: "danger",
  completed: "success",
  cancelled: "neutral",
};

const LABEL: Record<RunStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  pending: "Pending",
  failed: "Failed",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const runStatusLabel = (status: RunStatus) => LABEL[status];

export function RunStatusChip({ status }: { status: RunStatus }) {
  return <StatusChip tone={TONE[status]}>{LABEL[status]}</StatusChip>;
}

/** `policy:<uuid>` → a link target in admin, when the subject has a page. */
export function subjectLink(subject: string) {
  const [type, id] = subject.split(":");

  if (type === "policy" && id)
    return { to: "/policies/$policyId" as const, params: { policyId: id } };

  if (type === "submission" && id)
    return { to: "/submissions/$submissionId" as const, params: { submissionId: id } };

  return null;
}

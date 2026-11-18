import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "accent" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

export function SubmissionStatus({ status }: { status: string }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "accent" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  quoted: { label: "Quoted", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  referred: { label: "Referred", tone: "warning" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  bound: { label: "Bound", tone: "success" },
};

export function SubmissionStatus({
  status,
  quote,
}: {
  status: string;
  quote?: { status: string; approved: boolean } | null;
}) {
  const key = quote
    ? quote.approved && quote.status === "quoted"
      ? "approved"
      : quote.status
    : status;

  const { label, tone } = STATUS[key] ?? { label: key, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

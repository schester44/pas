import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { daysUntil } from "@pas/ui/lib/policy-change";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_effective: { label: "Pending effective", tone: "accent" },
  in_force: { label: "In force", tone: "success" },
  pending_cancellation: { label: "Pending cancellation", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function countdown(date: string) {
  const days = daysUntil(date);

  return days <= 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;
}

export function PolicyStatus({
  status,
  cancellation,
}: {
  status: string;
  cancellation?: { effectiveDate: string; status: string } | null;
}) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };
  const pending = status === "pending_cancellation" && cancellation?.status === "pending";

  return (
    <StatusChip tone={tone}>
      {label}
      {pending && (
        <span className="font-normal tabular-nums">· {countdown(cancellation.effectiveDate)}</span>
      )}
    </StatusChip>
  );
}

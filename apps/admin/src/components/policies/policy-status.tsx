import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_effective: { label: "Pending effective", tone: "accent" },
  in_force: { label: "In force", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export function PolicyStatus({ status }: { status: string }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

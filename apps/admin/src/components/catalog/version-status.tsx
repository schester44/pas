import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In review", tone: "warning" },
  published: { label: "Published", tone: "success" },
  retired: { label: "Retired", tone: "neutral" },
};

export function VersionStatus({ status }: { status: string }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

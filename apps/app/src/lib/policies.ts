import type { StatusTone } from "@pas/ui/components/status-chip";

export const TERM_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_effective: { label: "Pending effective", tone: "accent" },
  in_force: { label: "In force", tone: "success" },
  pending_cancellation: { label: "Pending cancellation", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

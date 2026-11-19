import type { AdminOutputs } from "@pas/api-client";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { formatPlainDate } from "@/lib/format";

export type Agency = AdminOutputs["distribution"]["agencies"]["list"][number];
export type AgencyDetail = AdminOutputs["distribution"]["agencies"]["get"];
export type Producer = AgencyDetail["producers"][number];
export type ProducerDetail = AdminOutputs["distribution"]["producers"]["get"];
export type License = Producer["licenses"][number];

const HEALTH: Record<License["health"], { tone: StatusTone; label: string }> = {
  current: { tone: "success", label: "Current" },
  expiring: { tone: "warning", label: "Expiring" },
  expired: { tone: "danger", label: "Expired" },
  inactive: { tone: "neutral", label: "Inactive" },
};

export function LicenseHealth({ health }: { health: License["health"] }) {
  return <StatusChip tone={HEALTH[health].tone}>{HEALTH[health].label}</StatusChip>;
}

const AGENCY_TONES: Record<Agency["status"], StatusTone> = {
  active: "success",
  suspended: "warning",
  terminated: "neutral",
};

const sentence = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function AgencyStatus({ status }: { status: Agency["status"] }) {
  return <StatusChip tone={AGENCY_TONES[status]}>{sentence(status)}</StatusChip>;
}

export function ProducerStatus({ status }: { status: Producer["status"] }) {
  return (
    <StatusChip
      tone={status === "active" ? "success" : status === "invited" ? "accent" : "neutral"}
    >
      {sentence(status)}
    </StatusChip>
  );
}

export const stateName = (license: Pick<License, "country" | "subdivision">) =>
  jurisdictionName({ country: license.country, subdivision: license.subdivision });

export const expiryLabel = (license: Pick<License, "expirationDate">) =>
  license.expirationDate ? formatPlainDate(license.expirationDate) : "No expiry";

export const tierLabel = (tier: string) => sentence(tier);

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-sm leading-5 font-medium">{children}</dd>
    </div>
  );
}

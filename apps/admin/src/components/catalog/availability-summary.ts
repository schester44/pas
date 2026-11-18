import { formatPlainDate } from "@/lib/format";
import { jurisdictionShort } from "@pas/ui/lib/jurisdictions";
import type { AvailabilityWindow } from "./version-editor";

export function availabilitySummary(availability: readonly AvailabilityWindow[]): string | null {
  if (availability.length === 0) return null;

  const codes = availability.map((w) => jurisdictionShort(w.jurisdiction)).toSorted();

  const shown =
    codes.length > 4 ? `${codes.slice(0, 3).join(", ")} +${codes.length - 3}` : codes.join(", ");

  const earliest = availability.map((w) => w.newBusiness.from).toSorted()[0]!;

  return `${shown} · from ${formatPlainDate(earliest)}`;
}

export function nextVersionLabel(labels: readonly string[]): string {
  const latest = labels[0];

  if (!latest) return `${new Date().getFullYear() + 1}.1`;

  const match = /^(.*?)(\d+)$/.exec(latest);

  if (!match) return `${latest}-2`;

  let n = Number(match[2]) + 1;

  while (labels.includes(`${match[1]}${n}`)) n++;

  return `${match[1]}${n}`;
}

import type { AdminOutputs } from "@pas/api-client";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { addDays, formatDateWindow } from "@/lib/format";

export type ObligationSummary = AdminOutputs["compliance"]["list"][number];
export type ObligationDetail = AdminOutputs["compliance"]["get"];

export const KIND_LABELS: Record<string, string> = {
  sl_filing: "Surplus lines filing",
  sl_affidavit: "Diligent search affidavit",
  sl_remittance: "Surplus lines tax remittance",
  notice: "Notice",
  bordereau: "Bordereau",
  stat_report: "Statistical report",
  adverse_action: "Adverse action notice",
  evidence_of_insurance: "Evidence of insurance",
  ams_download: "AMS download",
  carrier_report: "Carrier report",
  custom: "Other",
};

export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

export const stateLabel = (code: string) =>
  code.includes("-") ? jurisdictionName({ country: code.slice(0, 2), subdivision: code }) : code;

const STATES: Record<ObligationSummary["state"], { tone: StatusTone; label: string }> = {
  due: { tone: "neutral", label: "Due" },
  overdue: { tone: "danger", label: "Overdue" },
  rejected: { tone: "warning", label: "Rejected" },
  submitted: { tone: "accent", label: "Submitted" },
  done: { tone: "success", label: "Filed" },
  waived: { tone: "neutral", label: "Waived" },
};

export function ObligationState({
  obligation,
}: {
  obligation: Pick<ObligationSummary, "state" | "status">;
}) {
  const state = STATES[obligation.state];

  const label =
    obligation.state === "done"
      ? obligation.status === "completed"
        ? "Completed"
        : "Accepted"
      : state.label;

  return <StatusChip tone={state.tone}>{label}</StatusChip>;
}

export const subjectLabel = (o: Pick<ObligationSummary, "subject">) =>
  o.subject.type === "period" && o.subject.periodStart && o.subject.periodEnd
    ? formatDateWindow({ from: o.subject.periodStart, to: addDays(o.subject.periodEnd, 1) })
    : `${o.subject.policyNumber ?? ""} · ${(o.subject.transactionType ?? "").toLowerCase().replaceAll("_", " ")}`;

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export function downloadFile(file: { fileName: string; contentType: string; base64: string }) {
  const url = URL.createObjectURL(new Blob([fromBase64(file.base64)], { type: file.contentType }));
  const link = document.createElement("a");

  link.href = url;
  link.download = file.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

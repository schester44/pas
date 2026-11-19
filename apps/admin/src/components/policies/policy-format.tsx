import type { AdminOutputs } from "@pas/api-client";
import { humanize } from "@/components/decisions/jdm-edit";
import { formatMoney } from "@/lib/format";

export type Policy = AdminOutputs["policies"]["get"];
export type Billing = AdminOutputs["policies"]["billing"];
export type Coverage = Policy["coverages"][number];
export type Transaction = Policy["transactions"][number];

type Amount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

export const isZero = (value: { amount: string } | null | undefined) =>
  !value || Number(value.amount) === 0;

export function amount(value: unknown) {
  const a = value as Amount | undefined;

  if (!a) return <span className="text-muted-foreground">–</span>;

  return a.kind === "money" ? formatMoney(a) : `${a.value}%`;
}

const TYPE_LABELS: Record<string, string> = {
  NEW_BUSINESS: "New business",
  ENDORSEMENT: "Endorsement",
  CANCELLATION: "Cancellation",
  CANCELLATION_RESCISSION: "Cancellation rescission",
  REINSTATEMENT: "Reinstatement",
};

const STATUS_LABELS: Record<string, string> = {
  quoted: "Quoted",
  pending_approval: "Pending approval",
  pending_carrier: "Pending carrier",
  scheduled: "Scheduled",
  issued: "Issued",
};

export const transactionType = (type: string) => TYPE_LABELS[type] ?? humanize(type.toLowerCase());

export const transactionStatus = (status: string) => STATUS_LABELS[status] ?? humanize(status);

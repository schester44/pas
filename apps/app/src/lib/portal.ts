import type { AppOutputs } from "@pas/api-client";
import type { StatusTone } from "@pas/ui/components/status-chip";
import { formatMoney, type MoneyValue } from "./format";

export type ClientPolicy = AppOutputs["client"]["policies"]["get"];
export type ClientPolicySummary = AppOutputs["client"]["policies"]["list"][number];
export type ClientInvoice = AppOutputs["client"]["invoices"]["list"][number];

export const POLICY_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_effective: { label: "Upcoming", tone: "accent" },
  in_force: { label: "Active", tone: "success" },
  pending_cancellation: { label: "Cancelling", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  scheduled: { label: "Upcoming", tone: "neutral" },
  open: { label: "Due", tone: "warning" },
  past_due: { label: "Past due", tone: "danger" },
  partially_paid: { label: "Partly paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

export const policyStatus = (status: string) =>
  POLICY_STATUS[status] ?? { label: status, tone: "neutral" as const };

const CREDIT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Credit", tone: "neutral" },
  partially_paid: { label: "Part applied", tone: "neutral" },
  paid: { label: "Settled", tone: "success" },
};

export const invoiceStatus = (status: string, kind?: string) =>
  (kind === "credit_note" ? CREDIT_STATUS[status] : undefined) ??
  INVOICE_STATUS[status] ?? { label: status, tone: "neutral" as const };

export const isDue = (invoice: Pick<ClientInvoice, "kind" | "status">) =>
  invoice.kind === "invoice" &&
  (invoice.status === "open" ||
    invoice.status === "partially_paid" ||
    invoice.status === "past_due");

export function totalDue(invoices: ClientInvoice[]): MoneyValue | null {
  const due = invoices.filter(isDue);

  if (due.length === 0) return null;

  const cents = due.reduce((sum, i) => sum + Math.round(Number(i.balance.amount) * 100), 0);

  return { amount: (cents / 100).toFixed(2), currency: due[0]!.balance.currency };
}

type Amount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

const isAmount = (value: unknown): value is Amount =>
  typeof value === "object" && value !== null && "kind" in value;

export function amountText(value: unknown): string | null {
  if (!isAmount(value)) return null;

  return value.kind === "money" ? formatMoney(value) : `${value.value}%`;
}

/** "locations[1]" reads as "Location 2". */
export function exposureText(exposure: string | undefined): string | null {
  const match = exposure ? /^(?:.*\.)?([a-zA-Z]+)\[(\d+)\]$/.exec(exposure) : null;

  if (!match) return null;

  const noun = match[1]!
    .replace(/s$/, "")
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();

  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${Number(match[2]) + 1}`;
}

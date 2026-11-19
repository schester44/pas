import { Notice } from "@pas/ui/components/notice";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export type MoneyJson = { amount: string; currency: string };

export const money = (value: MoneyJson) =>
  formatMoney(Number(value.amount).toFixed(2), value.currency);

/** Right-aligned, tabular; zero is a muted dash (docs/design.md tables). */
export function Amount({
  value,
  className,
}: {
  value: MoneyJson | null | undefined;
  className?: string;
}) {
  if (!value || Number(value.amount) === 0) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  return <span className={cn("tabular-nums", className)}>{money(value)}</span>;
}

export const RAIL_LABEL: Record<string, string> = {
  card: "Card",
  ach_debit: "ACH debit",
  ach_push: "ACH push",
  wire: "Wire",
  check: "Check",
  lockbox: "Lockbox",
};

export const PAYER_LABEL: Record<string, string> = {
  insured: "Insured",
  agency: "Agency",
  mortgagee: "Mortgagee",
};

const PAYMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  unapplied: { label: "Unapplied", tone: "warning" },
  partially_applied: { label: "Part applied", tone: "warning" },
  applied: { label: "Applied", tone: "success" },
  reversed: { label: "Reversed", tone: "danger" },
};

export function PaymentStatus({ status }: { status: string }) {
  const { label, tone } = PAYMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

const WORK_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_approval: { label: "Needs approval", tone: "warning" },
  posted: { label: "Posted", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  requested: { label: "Check requested", tone: "warning" },
  issued: { label: "Issued", tone: "success" },
  open: { label: "Open", tone: "warning" },
  deposited: { label: "Deposited", tone: "success" },
  matched: { label: "Matched", tone: "success" },
  exception: { label: "Exception", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
  balanced: { label: "Balanced", tone: "success" },
  differences: { label: "Differences", tone: "danger" },
};

export function WorkStatus({ status }: { status: string }) {
  const { label, tone } = WORK_STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/** One key per open form, so a retried submit is the same request (Idempotency-Key). */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(() => crypto.randomUUID());

  return [key, () => setKey(crypto.randomUUID())];
}

export function useLedgerOverview() {
  const trpc = useTRPC();

  return useQuery(trpc.ledger.overview.queryOptions());
}

/** Ledger screens only work when the native billing system is the tenant's billing system. */
export function ExternalBillingNotice() {
  return (
    <Notice title="An external billing system is connected">
      Payments, cash application and the ledger live there. Switch to native billing in Settings,
      Integrations to use them here.
    </Notice>
  );
}

export function downloadCsv(file: { fileName: string; content: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: "text/csv" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const AMOUNT = /^\d+(\.\d{1,2})?$/;

export const validAmount = (value: string) => AMOUNT.test(value.trim()) && Number(value) > 0;

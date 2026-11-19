import { Money } from "@pas/kernel";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { cn } from "@pas/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { humanize } from "@/components/decisions/jdm-edit";
import { formatDate, formatMoney, formatPlainDate } from "@/lib/format";
import { exposureLabel } from "@pas/ui/lib/policy-change";
import { type Policy, type Transaction, transactionStatus, transactionType } from "./policy-format";

type Financial = Policy["financials"][number];

/** Policy transactions with their premium detail, then the financial ledger they wrote. */
export function PolicyTransactions({ policy }: { policy: Policy }) {
  const transactions = policy.transactions.toReversed();

  return (
    <div className="grid gap-6">
      <Panel title="Transactions" flush>
        <ul className="m-0 list-none divide-y p-0">
          {transactions.map((t) => (
            <TransactionRow key={t.id} transaction={t} labels={policy.exposureLabels} />
          ))}
        </ul>
      </Panel>
      <Ledger policy={policy} />
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-(--card-p) py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
    >
      <ChevronRight
        aria-hidden
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-90",
        )}
      />
      {children}
    </button>
  );
}

function TransactionRow({
  transaction: t,
  labels,
}: {
  transaction: Transaction;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const pending = t.status !== "issued";

  return (
    <li>
      <Disclosure open={open} onToggle={() => setOpen((v) => !v)}>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            {transactionType(t.type)}
            {pending && <StatusChip tone="accent">{transactionStatus(t.status)}</StatusChip>}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            Effective {formatPlainDate(t.effectiveDate)}
            {t.issuedAt
              ? ` · issued ${formatDate(t.issuedAt)}`
              : t.createdBy
                ? ` · by ${t.createdBy}`
                : ""}
          </span>
        </span>
        <span className="text-right text-sm whitespace-nowrap tabular-nums">
          {formatMoney(t.premiumDelta)}
        </span>
      </Disclosure>
      {open && <TransactionDetail transaction={t} labels={{ ...labels, ...t.exposureLabels }} />}
    </li>
  );
}

function TransactionDetail({
  transaction: t,
  labels,
}: {
  transaction: Transaction;
  labels: Record<string, string>;
}) {
  const changed = t.premium.filter((line) => Number(line.amount.amount) !== 0);

  return (
    <div className="grid gap-4 border-t bg-muted/30 px-(--card-p) py-4 sm:pl-14">
      {t.changes.length > 0 && (
        <Section title="Changes">
          {t.changes.map((c) => (
            <Line key={c.path} label={c.label}>
              <span className="text-muted-foreground">{display(c.before)}</span> →{" "}
              {display(c.after)}
            </Line>
          ))}
        </Section>
      )}
      {t.cancellation && (
        <Section title="Cancellation">
          <Line label="Reason">{t.cancellation.reasonLabel}</Line>
          <Line label="Notice date">{formatPlainDate(t.cancellation.noticeDate)}</Line>
          <Line label="Method">{humanize(t.cancellation.method)}</Line>
        </Section>
      )}
      {changed.length > 0 && (
        <Section title="Premium">
          {changed.map((line) => (
            <Line
              key={`${line.coverage}@${line.exposure ?? ""}`}
              label={`${line.name}${line.exposure ? ` · ${exposureLabel(line.exposure, labels) ?? "Policy"}` : ""}`}
            >
              {formatMoney(line.amount)}
            </Line>
          ))}
        </Section>
      )}
      {t.reroll.map((segment) => (
        <Section key={segment.transactionId} title={`Re-rates the ${segment.label}`}>
          <Line label="Offset in full">{formatMoney(segment.reversed)}</Line>
          <Line label={`Re-applied from ${formatPlainDate(segment.effectiveDate)}`}>
            {formatMoney(segment.reissued)}
          </Line>
          {segment.conflicts.map((c) => (
            <Line key={c.path} label={c.label}>
              {c.outcome === "no_longer_applies"
                ? "No longer applies"
                : `${display(c.theirs)} from ${formatPlainDate(segment.effectiveDate)}`}
            </Line>
          ))}
        </Section>
      ))}
      {t.fees.length > 0 && (
        <Section title="Taxes and fees">
          {t.fees.map((fee) => (
            <Line key={fee.code} label={fee.label}>
              {formatMoney(fee.amount)}
            </Line>
          ))}
        </Section>
      )}
      <dl className="m-0 grid gap-1.5 border-t pt-3 text-sm">
        <div className="flex justify-between gap-4 font-medium">
          <dt>Total</dt>
          <dd className="m-0 tabular-nums">{formatMoney(t.total)}</dd>
        </div>
        {t.annualAfter && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>Annual premium after</dt>
            <dd className="m-0 tabular-nums">{formatMoney(t.annualAfter)}</dd>
          </div>
        )}
      </dl>
      {(t.note || t.approvedBy) && (
        <p className="m-0 text-xs text-muted-foreground">
          {t.note}
          {t.note && t.approvedBy && " · "}
          {t.approvedBy && `Approved by ${t.approvedBy}`}
        </p>
      )}
    </div>
  );
}

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "–";

  if (typeof value === "object") {
    const v = value as { kind?: string; amount?: string; currency?: string; value?: string };

    if (v.kind === "money" && v.amount && v.currency)
      return formatMoney({ amount: v.amount, currency: v.currency });

    if (v.kind === "percent") return `${v.value}%`;

    return JSON.stringify(value);
  }

  return String(value);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="m-0 text-xs font-medium text-muted-foreground">{title}</h3>
      <dl className="m-0 grid gap-1">{children}</dl>
    </section>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="min-w-0">{label}</dt>
      <dd className="m-0 text-right tabular-nums">{children}</dd>
    </div>
  );
}

const sum = (lines: Financial[]) =>
  lines
    .map((f) => Money.of(f.amount.amount, f.amount.currency))
    .reduce((a, b) => a.plus(b))
    .toJSON();

function Ledger({ policy }: { policy: Policy }) {
  const groups = [...Map.groupBy(policy.financials, (f) => f.transactionId).values()].toReversed();
  const transactions = new Map(policy.transactions.map((t) => [t.id, t]));

  if (groups.length === 0) return null;

  return (
    <Panel
      title="Financial transactions"
      description="Written premium by coverage, plus taxes and fees."
      flush
    >
      <ul className="m-0 list-none divide-y p-0">
        {groups.map((group) => (
          <LedgerGroup
            key={group[0]!.transactionId}
            lines={group}
            source={transactions.get(group[0]!.transactionId)}
            labels={policy.exposureLabels}
          />
        ))}
      </ul>
    </Panel>
  );
}

function LedgerGroup({
  lines,
  source,
  labels,
}: {
  lines: Financial[];
  source?: Transaction;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const first = lines[0]!;

  return (
    <li>
      <Disclosure open={open} onToggle={() => setOpen((v) => !v)}>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm font-medium">
            {source ? transactionType(source.type) : "Entries"}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            Effective {formatPlainDate(first.effectiveDate)}
            <span className="hidden sm:inline">
              {" "}
              · recorded {formatDate(first.recordedAt)}
            </span> ·{" "}
            {lines.length} lines
          </span>
        </span>
        <span className="text-right text-sm whitespace-nowrap tabular-nums">
          {formatMoney(sum(lines))}
        </span>
      </Disclosure>
      {open && (
        <ul className="m-0 list-none divide-y border-t bg-muted/30 p-0">
          {lines.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-4 py-2.5 pr-(--card-p) pl-(--card-p) text-sm sm:pl-14"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate">
                  {f.label}
                  {f.exposure && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {exposureLabel(f.exposure, labels) ?? "Policy"}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {f.kind === "written_premium" ? "Written premium" : "Tax or fee"}
                  {f.effectiveDate !== source?.effectiveDate &&
                    ` · effective ${formatPlainDate(f.effectiveDate)}`}
                  {f.remitter && ` · remitted by ${humanize(f.remitter).toLowerCase()}`}
                </span>
              </span>
              <span className="tabular-nums">{formatMoney(f.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

import type { DecisionKind, DecisionResult, UnderwritingOutcome } from "@pas/decisions-engine";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { cn } from "@pas/ui/lib/utils";
import type * as React from "react";
import { formatMoney } from "@/lib/format";
import { humanize } from "./jdm-edit";

export const OUTCOMES: Record<UnderwritingOutcome, { label: string; tone: StatusTone }> = {
  pass: { label: "Pass", tone: "success" },
  info_needed: { label: "Info needed", tone: "accent" },
  refer: { label: "Refer", tone: "warning" },
  decline: { label: "Decline", tone: "danger" },
};

const DOTS: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  accent: "bg-primary",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-muted-foreground/60",
};

export const formatDuration = (ms: number) => (ms < 1 ? "<1 ms" : `${ms.toFixed(1)} ms`);

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 4 });

const words = (codes: string[]) => (codes.length > 0 ? codes.map(humanize).join(", ") : "None");

export function DecisionResultView({
  kind,
  result,
  durationMs,
}: {
  kind: DecisionKind;
  result: unknown;
  durationMs: number;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-sm font-medium">Result</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatDuration(durationMs)}
        </span>
      </div>
      <KindResult kind={kind} result={result} />
    </section>
  );
}

function KindResult({ kind, result }: { kind: DecisionKind; result: unknown }) {
  switch (kind) {
    case "underwriting":
    case "eligibility":
      return <Outcomes result={result as DecisionResult<"underwriting">} />;
    case "taxes_fees":
      return <TaxLines result={result as DecisionResult<"taxes_fees">} />;
    case "dea":
      return <Dea result={result as DecisionResult<"dea">} />;
    case "notice_rules":
      return <NoticeRules result={result as DecisionResult<"notice_rules">} />;
    case "form_schedule":
      return (
        <Rows
          empty="No documents scheduled."
          items={(result as DecisionResult<"form_schedule">).documents.map((key) => ({
            key,
            title: <code className="font-mono text-[0.8125rem]">{key}</code>,
          }))}
        />
      );
    case "referral_triggers":
      return (
        <Rows
          empty="No referral triggers fired."
          items={(result as DecisionResult<"referral_triggers">).triggers.map((trigger) => ({
            key: trigger.code,
            title: trigger.message,
            meta: trigger.code,
          }))}
        />
      );
    case "coverage_options":
      return (
        <Rows
          empty="No coverage options."
          items={Object.entries((result as DecisionResult<"coverage_options">).coverages).map(
            ([code, entry]) => ({
              key: code,
              title: code,
              meta: `${entry.options.join(", ")}${entry.default === undefined ? "" : ` · default ${entry.default}`}`,
            }),
          )}
        />
      );
    case "custom":
      return (
        <pre className="m-0 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}

function Outcomes({ result }: { result: DecisionResult<"underwriting"> }) {
  const overall = OUTCOMES[result.overall];
  const lead = result.outcomes.find((o) => o.outcome === result.overall);

  const ordered = result.outcomes.toSorted((a, b) => rank(b.outcome) - rank(a.outcome));

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3 rounded-lg border px-3 py-3">
        <StatusChip tone={overall.tone} className="mt-px">
          {overall.label}
        </StatusChip>
        <div className="grid gap-0.5">
          <p className="m-0 text-sm leading-5 font-medium">
            {lead?.message ?? "No rule raised a concern."}
          </p>
          {lead && ordered.length === 1 && (
            <p className="m-0 text-xs text-muted-foreground">{outcomeMeta(lead)}</p>
          )}
        </div>
      </div>
      {ordered.length > 1 && (
        <Rows
          items={ordered.map((outcome, i) => ({
            key: `${outcome.rule}-${i}`,
            dot: DOTS[OUTCOMES[outcome.outcome].tone],
            title: outcome.message,
            meta: `${OUTCOMES[outcome.outcome].label} · ${outcomeMeta(outcome)}`,
            detail: outcome.internalMessage,
          }))}
        />
      )}
    </div>
  );
}

const outcomeMeta = (outcome: { reasonCode: string; authority?: string }) =>
  [outcome.reasonCode, outcome.authority && `Needs ${humanize(outcome.authority).toLowerCase()}`]
    .filter(Boolean)
    .join(" · ");

const rank = (outcome: UnderwritingOutcome) =>
  ["pass", "info_needed", "refer", "decline"].indexOf(outcome);

function TaxLines({ result }: { result: DecisionResult<"taxes_fees"> }) {
  return (
    <Rows
      empty="No taxes or fees apply."
      items={result.lines.map((line) => ({
        key: line.code,
        title: line.label,
        meta: [
          line.code,
          line.basis === "flat" ? "Flat" : `On ${humanize(line.basis).toLowerCase()}`,
          `Remitted by ${line.remitter}`,
          line.taxable ? "Taxable" : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        value:
          line.rate !== undefined
            ? percent.format(Number(line.rate))
            : formatMoney(line.amount!, line.currency!),
      }))}
    />
  );
}

function Dea({ result }: { result: DecisionResult<"dea"> }) {
  if (!result) return <p className="m-0 text-sm text-muted-foreground">No rule matched.</p>;

  return (
    <Facts
      facts={[
        ["Diligent search", result.required ? "Required" : "Not required"],
        ["Declinations", result.required ? String(result.declinationsRequired) : "–"],
        ["Due", result.timing ? humanize(result.timing) : "–"],
        ["Exemptions", words(result.exemptions)],
      ]}
    />
  );
}

function NoticeRules({ result }: { result: DecisionResult<"notice_rules"> }) {
  if (!result) return <p className="m-0 text-sm text-muted-foreground">No rule matched.</p>;

  return (
    <Facts
      facts={[
        ["Minimum notice", `${result.minDaysNotice} days`],
        ["Added when mailed", `${result.mailingDaysAdded} days`],
        ["Allowed reasons", words(result.allowedReasons)],
        ["Delivery", words(result.deliveryMethods)],
        ["Recipients", words(result.recipients)],
      ]}
    />
  );
}

function Facts({ facts }: { facts: [string, string][] }) {
  return (
    <dl className="m-0 grid divide-y rounded-lg border">
      {facts.map(([term, value]) => (
        <div key={term} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="m-0 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface RowItem {
  key: string;
  title: React.ReactNode;
  meta?: string;
  detail?: string;
  value?: string;
  dot?: string;
}

function Rows({ items, empty }: { items: RowItem[]; empty?: string }) {
  if (items.length === 0) return <p className="m-0 text-sm text-muted-foreground">{empty}</p>;

  return (
    <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
      {items.map((item) => (
        <li key={item.key} className="flex items-start gap-3 px-3 py-2.5">
          {item.dot && (
            <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.dot)} />
          )}
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="text-sm leading-5 font-medium">{item.title}</span>
            {item.meta && <span className="text-xs text-muted-foreground">{item.meta}</span>}
            {item.detail && (
              <span className="text-xs text-muted-foreground">Internal: {item.detail}</span>
            )}
          </div>
          {item.value && (
            <span className="shrink-0 text-sm font-medium tabular-nums">{item.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

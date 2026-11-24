import { formatMoney } from "@pas/kernel";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Notice } from "./notice";
import { Panel } from "./panel";
import { Spinner } from "./spinner";

interface Value {
  key: string;
  label: string;
  kind: string;
  value: unknown;
}

export interface EnrichmentView {
  sources: {
    callId: string;
    capability: string;
    providerId: string;
    takenAt: string;
    values: Value[];
    tables: { key: string; label: string; columns: Value[]; rows: Record<string, unknown>[] }[];
  }[];
  derived: { key: string; value: unknown }[];
  discrepancies: {
    path: string;
    providerId: string | null;
    userValue: unknown;
    providerValue: unknown;
  }[];
  reports: {
    recordId: string;
    reportId: string;
    title: string;
    source: string;
    providerId: string | null;
  }[];
  missingReports: { reportId: string; title: string; reason: string }[];
  failedCalls: { callId: string; providerId: string | null; outcome: string }[];
}

type Report = EnrichmentView["reports"][number];

const CAPABILITY_LABELS: Record<string, string> = {
  geocode: "Location",
  property_characteristics: "Property",
  hazard_scores: "Hazards",
  tax_jurisdiction: "Tax jurisdiction",
  replacement_cost: "Replacement cost",
};

function display(value: unknown, kind = ""): string {
  if (value === null || value === undefined || value === "") return "—";

  if (kind === "money" && Number.isFinite(Number(value))) {
    return formatMoney({ amount: String(value), currency: "USD" }, { cents: "auto" });
  }

  if (typeof value === "number") return value.toLocaleString("en-US");

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "string") return value.replaceAll("_", " ");

  return JSON.stringify(value);
}

/**
 * The data enrichment a quote used (PLAN §11.1): what each provider returned, derived values,
 * where it disagrees with what was entered, and the reports to open.
 */
export function EnrichmentPanel({
  data,
  labelFor = (path) => path,
  providerName = (id) => id,
  onOpenReport,
}: {
  data: EnrichmentView;
  labelFor?: (path: string) => string;
  providerName?: (id: string) => string;
  onOpenReport: (report: Report) => Promise<void>;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const providers = [...new Set(data.sources.map((s) => providerName(s.providerId)))];

  const latest = data.sources
    .map((s) => s.takenAt)
    .toSorted()
    .at(-1);

  async function open(report: Report) {
    setOpening(report.reportId);

    try {
      await onOpenReport(report);
    } finally {
      setOpening(null);
    }
  }

  return (
    <Panel
      title="Property data"
      description={
        providers.length > 0 &&
        `${providers.join(", ")}${latest ? ` · ${formatDateTime(latest)}` : ""}`
      }
      flush
    >
      <div className="grid divide-y">
        {data.discrepancies.length > 0 && (
          <div className="p-(--card-p)">
            <Notice tone="warning" title="Some answers differ from the data">
              <ul className="m-0 grid list-none gap-1 p-0">
                {data.discrepancies.map((d) => (
                  <li key={d.path} className="tabular-nums">
                    {labelFor(d.path)}: entered {display(d.userValue)}
                    {d.providerId ? ` · ${providerName(d.providerId)} says ` : " · data says "}
                    {display(d.providerValue)}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        )}

        {data.sources.map((source) => (
          <section key={source.callId} className="grid gap-3 p-(--card-p)">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="m-0 text-sm leading-5 font-medium">
                {CAPABILITY_LABELS[source.capability] ?? source.capability}
              </h3>
              <span className="text-xs text-muted-foreground">
                {providerName(source.providerId)}
              </span>
            </div>
            <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {source.values.map((value) => (
                <div key={value.key} className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm text-muted-foreground">{value.label}</dt>
                  <dd className="m-0 text-sm tabular-nums">{display(value.value, value.kind)}</dd>
                </div>
              ))}
            </dl>
            {source.tables.map((table) => (
              <div key={table.key} className="grid gap-2">
                <h4 className="m-0 text-xs font-medium text-muted-foreground">{table.label}</h4>
                <table className="w-full text-sm">
                  <tbody>
                    {table.rows.map((row, i) => (
                      <tr
                        key={i}
                        className={cn(
                          "border-b last:border-0",
                          row.excluded === true && "text-muted-foreground",
                        )}
                      >
                        {table.columns
                          .filter((column) => column.kind !== "boolean")
                          .map((column, c) => (
                            <td
                              key={column.key}
                              className={cn("py-1.5", c > 0 && "text-right tabular-nums")}
                            >
                              {display(row[column.key], column.kind)}
                              {c === 0 && row.excluded === true && " (excluded)"}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        ))}

        {data.derived.length > 0 && (
          <section className="grid gap-3 p-(--card-p)">
            <h3 className="m-0 text-sm leading-5 font-medium">Calculated</h3>
            <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {data.derived.map((d) => (
                <div key={d.key} className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm text-muted-foreground">{labelFor(`derived.${d.key}`)}</dt>
                  <dd className="m-0 text-sm tabular-nums">{display(d.value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {data.reports.length > 0 && (
          <ul className="m-0 list-none divide-y p-0">
            {data.reports.map((report) => (
              <li
                key={`${report.recordId}:${report.reportId}`}
                className="flex items-center gap-3 px-(--card-p) py-3"
              >
                <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{report.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {report.source === "vendor" && report.providerId
                      ? `From ${providerName(report.providerId)}`
                      : "Generated from the data"}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={opening === report.reportId}
                  aria-label={`Download ${report.title}`}
                  onClick={() => open(report)}
                >
                  {opening === report.reportId ? <Spinner /> : <Download />}
                  <span className="hidden sm:inline">Download</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        {(data.failedCalls.length > 0 || data.missingReports.length > 0) && (
          <p className="m-0 px-(--card-p) py-3 text-xs text-muted-foreground">
            {[
              ...data.failedCalls.map(
                (c) => `${c.providerId ? providerName(c.providerId) : c.callId} didn't answer`,
              ),
              ...data.missingReports.map((r) => `${r.title} isn't available: ${r.reason}`),
            ].join(". ")}
          </p>
        )}
      </div>
    </Panel>
  );
}

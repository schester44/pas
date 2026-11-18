import type { RiskSchema } from "@pas/forms-core";
import type { RatingResultJson, TraceValue } from "@pas/rating-engine/plan";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { cn } from "@pas/ui/lib/utils";
import type * as React from "react";
import type { Coverage } from "@/components/catalog/version-editor";
import { formatMoney } from "@/lib/format";
import { coverageLabel, exposureLabel } from "./model";
import type { RatingPreview } from "./use-rating";

const NUMBER = /^-?\d+(\.\d+)?$/;
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export function formatTrace(value: TraceValue): string {
  if (value === null) return "–";

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") return decimal.format(value);

  return NUMBER.test(value) ? decimal.format(Number(value)) : value;
}

const groupKey = (coverage?: string, exposure?: string) => `${coverage ?? ""}@${exposure ?? ""}`;

export function Worksheet({
  preview,
  coverages,
  schema,
  focus,
  sample,
  loading,
}: {
  preview: RatingPreview | undefined;
  coverages: readonly Coverage[];
  schema: RiskSchema;
  focus?: string;
  sample?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Panel
      flush
      title="Worksheet"
      description={
        <span className={cn(loading && "animate-pulse")}>
          How the sample risk is rated, step by step.
        </span>
      }
      action={sample}
    >
      {!preview ? (
        <div className="grid gap-3 p-(--card-p)">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : preview.status === "error" ? (
        <div className="p-(--card-p)">
          <Notice tone="error" title="Couldn't rate the sample">
            {preview.message}
          </Notice>
        </div>
      ) : (
        <WorksheetBody
          result={preview.result}
          coverages={coverages}
          schema={schema}
          focus={focus}
        />
      )}
    </Panel>
  );
}

function WorksheetBody({
  result,
  coverages,
  schema,
  focus,
}: {
  result: RatingResultJson;
  coverages: readonly Coverage[];
  schema: RiskSchema;
  focus: string | undefined;
}) {
  const lines = result.worksheet.filter((line) => !focus || line.coverage === focus);
  const groups = new Map<string, typeof lines>();

  for (const line of lines) {
    const key = groupKey(line.coverage, line.exposure);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const money = (amount: string) => formatMoney(amount, result.currency);

  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="h-10 bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="pl-(--card-p) font-medium">Step</th>
            <th className="px-3 font-medium">Inputs</th>
            <th className="pr-(--card-p) text-right font-medium">Result</th>
          </tr>
        </thead>
        {[...groups.values()].map((group) => {
          const first = group[0]!;

          return (
            <tbody key={groupKey(first.coverage, first.exposure)} className="border-t">
              {!focus || first.exposure ? (
                <tr>
                  <th
                    colSpan={3}
                    className="px-(--card-p) pt-3 pb-1 text-left text-xs font-medium text-muted-foreground"
                  >
                    {[
                      !focus && first.coverage && coverageLabel(coverages, first.coverage),
                      first.exposure && exposureLabel(schema, first.exposure),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Policy"}
                  </th>
                </tr>
              ) : null}
              {group.map((line, i) => (
                <tr key={i} className="align-top">
                  <td className="py-2 pl-(--card-p)">
                    <div className="grid gap-0.5">
                      <span className="font-medium">{line.name}</span>
                      <code className="font-mono text-[0.6875rem] text-muted-foreground">
                        {line.operation}
                      </code>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0 text-xs">
                      {line.inputs.map((input, j) => (
                        <li key={j} className="whitespace-nowrap">
                          <span className="text-muted-foreground">{input.ref}</span>{" "}
                          <span className="tabular-nums">{formatTrace(input.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="py-2 pr-(--card-p) text-right font-medium tabular-nums">
                    {formatTrace(line.output)}
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
      <dl className="m-0 grid gap-1.5 border-t bg-muted/40 px-(--card-p) py-3 text-sm">
        {result.coverages.map((c) => {
          const adjustment = result.adjustments.find(
            (a) => a.scope === "coverage" && a.coverage === c.coverage && a.exposure === c.exposure,
          );

          return (
            <div key={groupKey(c.coverage, c.exposure)} className="flex items-baseline gap-3">
              <dt className="min-w-0 flex-1 truncate text-muted-foreground">
                {coverageLabel(coverages, c.coverage)}
                {c.exposure && ` · ${exposureLabel(schema, c.exposure)}`}
                {adjustment && (
                  <span className="text-amber-900">
                    {" · raised to the "}
                    {money(adjustment.minimum.amount)} minimum
                  </span>
                )}
              </dt>
              <dd className="m-0 tabular-nums">{money(c.premium.amount)}</dd>
            </div>
          );
        })}
        {result.adjustments
          .filter((a) => a.scope === "policy")
          .map((a, i) => (
            <div key={i} className="flex items-baseline gap-3">
              <dt className="flex-1 text-amber-900">Policy minimum premium</dt>
              <dd className="m-0 tabular-nums">+{money(a.adjustment.amount)}</dd>
            </div>
          ))}
        <div className="flex items-baseline gap-3 border-t pt-2 font-semibold">
          <dt className="flex-1">Total premium</dt>
          <dd className="m-0 tabular-nums">{money(result.total.amount)}</dd>
        </div>
      </dl>
      {result.warnings.length > 0 && (
        <ul className="m-0 grid list-none gap-1 border-t px-(--card-p) py-3 text-xs text-amber-900">
          {result.warnings.map((warning, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

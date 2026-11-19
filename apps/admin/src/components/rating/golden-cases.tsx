import type {
  ConfiguredGoldenCase,
  GoldenCaseResult,
  GoldenReport,
  RaterSource,
  RatingInput,
} from "@pas/rating-engine/plan";
import { IntakeForm } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { Textarea } from "@pas/ui/components/textarea";
import { jurisdictionName, subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { Ellipsis, Plus, Target } from "lucide-react";
import { useId, useState } from "react";
import type { Contents } from "@/components/catalog/version-editor";
import { newId } from "@/components/decisions/jdm-edit";
import { formatMoney } from "@/lib/format";
import { formatMessage } from "@/lib/messages";
import { coverageLabel, coverageSelections, exposureLabel } from "./model";
import { type RatingPreview, useRatingPreview } from "./use-rating";

type Expected = ConfiguredGoldenCase["expected"];

const NUMBER = /^-?\d+(\.\d+)?$/;

export function expectedFrom(preview: RatingPreview | undefined): Expected | undefined {
  if (preview?.status !== "ok") return undefined;

  return {
    coverages: preview.result.coverages.map((c) => ({
      coverage: c.coverage,
      ...(c.exposure !== undefined && { exposure: c.exposure }),
      premium: c.premium.amount,
    })),
    total: preview.result.total.amount,
  };
}

function difference(
  result: GoldenCaseResult | undefined,
  currency: string,
  contents: Contents,
): string {
  if (!result) return "–";

  if (result.error) return result.error;

  const [first] = result.diffs;

  if (!first) return "–";

  const delta = first.difference
    ? `${first.difference.startsWith("-") ? "" : "+"}${formatMoney(first.difference, currency)}`
    : "missing";

  const premium = /^premium ([^@]+)(?:@(.+))?$/.exec(first.field);

  const field = premium
    ? [
        coverageLabel(contents.coverages, premium[1]!),
        premium[2] && exposureLabel(contents.riskSchema, premium[2]),
      ]
        .filter(Boolean)
        .join(" · ")
    : first.field;

  return `${field} ${delta}${result.diffs.length > 1 ? ` · ${result.diffs.length - 1} more` : ""}`;
}

export function GoldenCases({
  cases,
  report,
  source,
  contents,
  sampleInput,
  readOnly,
  running,
  selected,
  onSelect,
  onRun,
  onChange,
}: {
  cases: ConfiguredGoldenCase[];
  report: GoldenReport | null | undefined;
  source: RaterSource;
  contents: Contents;
  sampleInput: RatingInput;
  readOnly: boolean;
  running: boolean;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  onRun: () => void;
  onChange: (cases: ConfiguredGoldenCase[]) => void;
}) {
  const sample = useRatingPreview(source, sampleInput);
  const active = cases.find((c) => c.id === selected) ?? cases[0];
  const resultOf = (i: number) => report?.cases[i];
  const failing = report?.failed ?? 0;
  const currency = sampleInput.currency;

  const add = () => {
    const created: ConfiguredGoldenCase = {
      id: newId(),
      name: `Case ${cases.length + 1}`,
      input: structuredClone(sampleInput),
      expected: expectedFrom(sample.data) ?? { coverages: [] },
      tolerance: { absolute: "0.01" },
    };

    onChange([...cases, created]);
    onSelect(created.id);
  };

  const update = (id: string, next: ConfiguredGoldenCase) =>
    onChange(cases.map((c) => (c.id === id ? next : c)));

  const addAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={add} disabled={sample.data?.status !== "ok"}>
      <Plus /> Add case
    </Button>
  );

  if (cases.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<Target />}
          title="No golden cases yet"
          description={
            sample.data && sample.data.status !== "ok"
              ? "The sample risk doesn't rate yet. Fix the rater, then capture it as a case."
              : "Capture the sample risk with its premiums. Every case must still rate the same before publishing."
          }
          action={addAction}
        />
      </Panel>
    );
  }

  return (
    <div className="grid gap-6">
      <Panel
        flush
        title="Golden cases"
        description={
          <span className="tabular-nums">
            {!report
              ? "Fix the rater's errors to run the cases."
              : failing === 0
                ? `All ${report.total} passing`
                : `${failing} of ${report.total} failing · publishing is blocked`}
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onRun} disabled={running}>
              {running && <Spinner />}
              Run all
            </Button>
            {addAction}
          </div>
        }
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-10 bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="pl-(--card-p) font-medium">Case</th>
              <th className="px-3 font-medium">State</th>
              <th className="px-3 text-right font-medium">Expected total</th>
              <th className="px-3 font-medium">Difference</th>
              <th className="pr-(--card-p) text-right font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((golden, i) => {
              const result = resultOf(i);

              return (
                <tr
                  key={golden.id}
                  onClick={() => onSelect(golden.id)}
                  aria-selected={golden === active}
                  className={cn(
                    "h-13 cursor-pointer border-t transition-colors",
                    golden === active ? "bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <td className="pl-(--card-p) font-medium">{golden.name}</td>
                  <td className="px-3 text-muted-foreground">
                    {jurisdictionName(golden.input.jurisdiction)}
                  </td>
                  <td className="px-3 text-right tabular-nums">
                    {golden.expected.total ? formatMoney(golden.expected.total, currency) : "–"}
                  </td>
                  <td
                    className={cn(
                      "max-w-72 truncate px-3 tabular-nums",
                      result && !result.passed ? "text-red-700" : "text-muted-foreground",
                    )}
                  >
                    {difference(result, currency, contents)}
                  </td>
                  <td className="pr-(--card-p) text-right">
                    {!result ? (
                      <StatusChip>Not run</StatusChip>
                    ) : result.passed ? (
                      <StatusChip tone="success">Pass</StatusChip>
                    ) : (
                      <StatusChip tone="danger">Fail</StatusChip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      {active && (
        <CaseInspector
          key={active.id}
          golden={active}
          result={resultOf(cases.indexOf(active))}
          source={source}
          contents={contents}
          readOnly={readOnly}
          onChange={(next) => update(active.id, next)}
          onDelete={() => {
            onChange(cases.filter((c) => c.id !== active.id));
            onSelect(undefined);
          }}
        />
      )}
    </div>
  );
}

function quoteForm(forms: Contents["forms"]) {
  const quote = forms.filter((entry) => entry.stage === "quote");

  return quote.find((entry) => entry.channel === "internal") ?? quote[0] ?? forms[0];
}

function CaseInspector({
  golden,
  result,
  source,
  contents,
  readOnly,
  onChange,
  onDelete,
}: {
  golden: ConfiguredGoldenCase;
  result: GoldenCaseResult | undefined;
  source: RaterSource;
  contents: Contents;
  readOnly: boolean;
  onChange: (golden: ConfiguredGoldenCase) => void;
  onDelete: () => void;
}) {
  const id = useId();
  const preview = useRatingPreview(source, golden.input);
  const actual = preview.data?.status === "ok" ? preview.data.result : undefined;
  const currency = golden.input.currency;
  const [riskText, setRiskText] = useState(() => JSON.stringify(golden.input.risk, null, 2));
  const [riskError, setRiskError] = useState<string>();
  const intake = quoteForm(contents.forms);
  const [json, setJson] = useState(false);
  const country = golden.input.jurisdiction.country;

  const setInput = (input: RatingInput) => onChange({ ...golden, input });

  const applyRisk = (risk: Record<string, unknown>) => {
    const selections = coverageSelections(contents.coverages, risk);
    const same = selections.length === golden.input.coverages.length;

    setInput({ ...golden.input, risk, coverages: same ? golden.input.coverages : selections });
  };

  const setRisk = (text: string) => {
    setRiskText(text);

    try {
      const risk = JSON.parse(text) as unknown;

      if (typeof risk !== "object" || risk === null || Array.isArray(risk)) {
        setRiskError("Enter a JSON object.");

        return;
      }

      setRiskError(undefined);
      applyRisk(risk as Record<string, unknown>);
    } catch {
      setRiskError("This isn't valid JSON yet.");
    }
  };

  const expectedFor = (coverage: string, exposure: string | undefined) =>
    golden.expected.coverages?.find((c) => c.coverage === coverage && c.exposure === exposure);

  const setExpected = (coverage: string, exposure: string | undefined, premium: string) => {
    const others = (golden.expected.coverages ?? []).filter(
      (c) => !(c.coverage === coverage && c.exposure === exposure),
    );

    const rows = premium.trim()
      ? [
          ...others,
          { coverage, ...(exposure !== undefined && { exposure }), premium: premium.trim() },
        ]
      : others;

    onChange({ ...golden, expected: { ...golden.expected, coverages: rows } });
  };

  const setLimit = (index: number, limit: string) =>
    setInput({
      ...golden.input,
      coverages: golden.input.coverages.map((c, i) => (i === index ? { ...c, limit } : c)),
    });

  const capture = () => {
    const expected = expectedFrom(preview.data);

    if (expected) onChange({ ...golden, expected });
  };

  return (
    <Panel
      flush
      title={golden.name}
      description={
        result?.error
          ? result.error
          : result
            ? result.passed
              ? "Rates exactly as expected."
              : `${result.diffs.length} ${result.diffs.length === 1 ? "difference" : "differences"} from the expected premiums.`
            : "Not run yet."
      }
      action={
        !readOnly && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={capture} disabled={!actual}>
              Capture current result as expected
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8" aria-label="Case actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                  Delete case
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
    >
      <div className="grid lg:grid-cols-[26rem_minmax(0,1fr)] lg:divide-x">
        <div className="grid content-start gap-4 p-(--card-p)">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={golden.name}
              readOnly={readOnly}
              onChange={(event) => onChange({ ...golden, name: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-state`}>State</Label>
              <Select
                value={golden.input.jurisdiction.subdivision ?? ""}
                disabled={readOnly}
                onValueChange={(subdivision) =>
                  setInput({ ...golden.input, jurisdiction: { country, subdivision } })
                }
              >
                <SelectTrigger id={`${id}-state`}>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {subdivisionsOf(country).map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-tolerance`}>Tolerance</Label>
              <Input
                id={`${id}-tolerance`}
                inputMode="decimal"
                className="tabular-nums"
                readOnly={readOnly}
                value={golden.tolerance?.absolute ?? ""}
                placeholder="0.00"
                onChange={(event) => {
                  const absolute = event.target.value.trim();

                  onChange({ ...golden, tolerance: absolute ? { absolute } : {} });
                }}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-effective`}>Effective date</Label>
            <Input
              id={`${id}-effective`}
              type="date"
              className="tabular-nums"
              readOnly={readOnly}
              value={golden.input.term.effective}
              onChange={(event) => {
                const effective = event.target.value;

                if (!effective) return;

                setInput({
                  ...golden.input,
                  term: {
                    effective,
                    expiration: Temporal.PlainDate.from(effective).add({ years: 1 }).toString(),
                  },
                  transaction: { ...golden.input.transaction, effective },
                });
              }}
            />
          </div>
          <div className="grid gap-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={json ? `${id}-risk` : undefined}>Risk data</Label>
              {intake && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-my-1 -mr-2 text-muted-foreground"
                  aria-pressed={json}
                  onClick={() => {
                    setRiskText(JSON.stringify(golden.input.risk, null, 2));
                    setRiskError(undefined);
                    setJson(!json);
                  }}
                >
                  {json ? "Form" : "JSON"}
                </Button>
              )}
            </div>
            {json || !intake ? (
              <>
                <Textarea
                  id={`${id}-risk`}
                  value={riskText}
                  spellCheck={false}
                  readOnly={readOnly}
                  aria-invalid={!!riskError}
                  onChange={(event) => setRisk(event.target.value)}
                  className="max-h-[28rem] min-h-72 font-mono text-[0.8125rem] leading-5 [field-sizing:fixed]"
                />
                {riskError && <p className="m-0 text-sm text-destructive">{riskError}</p>}
              </>
            ) : (
              <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
                <IntakeForm
                  compact
                  schema={contents.riskSchema}
                  form={intake.form}
                  value={golden.input.risk}
                  onChange={applyRisk}
                />
              </fieldset>
            )}
          </div>
        </div>
        <div className="min-w-0 border-t lg:border-t-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="h-10 bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="pl-(--card-p) font-medium">Coverage</th>
                <th className="px-3 text-right font-medium">Limit</th>
                <th className="px-3 text-right font-medium">Expected</th>
                <th className="px-3 text-right font-medium">Actual</th>
                <th className="pr-(--card-p) text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {golden.input.coverages.map((selection, i) => {
                const expected = expectedFor(selection.coverage, selection.exposure);

                const got = actual?.coverages.find(
                  (c) => c.coverage === selection.coverage && c.exposure === selection.exposure,
                );

                const delta =
                  expected && got && NUMBER.test(expected.premium)
                    ? Number(got.premium.amount) - Number(expected.premium)
                    : undefined;

                const off =
                  delta !== undefined && Math.abs(delta) > Number(golden.tolerance?.absolute ?? 0);

                return (
                  <tr
                    key={`${selection.coverage}@${selection.exposure ?? ""}`}
                    className="border-t"
                  >
                    <td className="py-2 pl-(--card-p)">
                      <div className="grid gap-0.5">
                        <span className="font-medium">
                          {coverageLabel(contents.coverages, selection.coverage)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {exposureLabel(contents.riskSchema, selection.exposure)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        aria-label={`${selection.coverage} limit`}
                        className="ml-auto h-8 w-28 text-right tabular-nums"
                        readOnly={readOnly}
                        value={selection.limit ?? ""}
                        onChange={(event) => setLimit(i, event.target.value.trim())}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        aria-label={`${selection.coverage} expected premium`}
                        className={cn(
                          "ml-auto h-8 w-28 text-right tabular-nums",
                          off && "border-red-300 bg-red-50",
                        )}
                        readOnly={readOnly}
                        value={expected?.premium ?? ""}
                        onChange={(event) =>
                          setExpected(selection.coverage, selection.exposure, event.target.value)
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {got ? formatMoney(got.premium.amount, currency) : "–"}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-(--card-p) text-right tabular-nums",
                        off ? "font-medium text-red-700" : "text-muted-foreground",
                      )}
                    >
                      {delta === undefined || delta === 0
                        ? "–"
                        : `${delta > 0 ? "+" : ""}${formatMoney(delta.toFixed(2), currency)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-semibold">
                <td className="py-3 pl-(--card-p)" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-3 text-right">
                  <Input
                    aria-label="Expected total"
                    className="ml-auto h-8 w-28 text-right font-semibold tabular-nums"
                    readOnly={readOnly}
                    value={golden.expected.total ?? ""}
                    onChange={(event) => {
                      const { total: _, ...rest } = golden.expected;
                      const total = event.target.value.trim();

                      onChange({ ...golden, expected: total ? { ...rest, total } : rest });
                    }}
                  />
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {actual ? formatMoney(actual.total.amount, currency) : "–"}
                </td>
                <td className="pr-(--card-p)" />
              </tr>
            </tfoot>
          </table>
          {preview.data?.status === "error" && (
            <p className="m-0 border-t px-(--card-p) py-3 text-sm text-red-700">
              {formatMessage(preview.data, contents.coverages)}
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

import type { DecisionKind, DecisionTrace, NodeTrace } from "@pas/decisions-engine";
import {
  type FieldNode,
  getAt,
  indexSchema,
  isField,
  type RiskSchema,
  setAt,
} from "@pas/forms-core";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Textarea } from "@pas/ui/components/textarea";
import type * as React from "react";
import { useId, useMemo, useState } from "react";
import { humanize } from "./jdm-edit";
import { DecisionResultView, formatDuration } from "./results";

export type SimulatorRun =
  | { status: "blocked" }
  | { status: "error"; message: string; details?: string[] }
  | { status: "ok"; result: unknown; raw: unknown; trace: DecisionTrace; durationMs: number };

type RiskData = Record<string, unknown>;

export function SimulatorPanel({
  kind,
  schema,
  paths,
  input,
  onInputChange,
  run,
  tableNames,
}: {
  kind: DecisionKind;
  schema: RiskSchema;
  paths: string[];
  input: RiskData;
  onInputChange: (input: RiskData) => void;
  run: SimulatorRun | undefined;
  tableNames: ReadonlyMap<string, string>;
}) {
  const [mode, setMode] = useState<"form" | "json">("form");

  return (
    <Panel
      title="Simulator"
      description="Runs the decision live against a sample risk."
      action={
        <SegmentedControl
          label="Input mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "form", label: "Form" },
            { value: "json", label: "JSON" },
          ]}
        />
      }
    >
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {mode === "form" ? (
          <InputForm schema={schema} paths={paths} input={input} onChange={onInputChange} />
        ) : (
          <JsonInput input={input} onChange={onInputChange} />
        )}
        <div className="grid min-w-0 gap-6">
          <RunResult kind={kind} run={run} />
          {run?.status === "ok" && <TraceList trace={run.trace} tableNames={tableNames} />}
        </div>
      </div>
    </Panel>
  );
}

function InputForm({
  schema,
  paths,
  input,
  onChange,
}: {
  schema: RiskSchema;
  paths: string[];
  input: RiskData;
  onChange: (input: RiskData) => void;
}) {
  const index = useMemo(() => indexSchema(schema), [schema]);
  const scalar = paths.filter((path) => !path.includes("[]"));

  if (scalar.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        This decision doesn't read any fields yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {scalar.map((path) => {
        const node = index.get(path);

        return (
          <FieldControl
            key={path}
            path={path}
            label={node?.label ?? humanize(path)}
            node={node && isField(node) ? node : undefined}
            value={getAt(input, path)}
            onChange={(value) => onChange(setAt(input, path, value))}
          />
        );
      })}
    </div>
  );
}

const NUMERIC = new Set(["number", "integer", "money", "percent"]);

function FieldControl({
  path,
  label,
  node,
  value,
  onChange,
}: {
  path: string;
  label: string;
  node: FieldNode | undefined;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = useId();
  const kind = node?.kind;

  let control: React.ReactNode;

  if (kind === "boolean") {
    control = (
      <SegmentedControl
        label={label}
        className="w-fit"
        value={value === true ? "yes" : value === false ? "no" : ""}
        onValueChange={(next) => onChange(next === "yes")}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
      />
    );
  } else if (kind === "enum" && node && "options" in node && node.options) {
    control = (
      <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
        <SelectContent>
          {node.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  } else if (kind && NUMERIC.has(kind)) {
    control = (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        className="tabular-nums"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
      />
    );
  } else {
    control = (
      <Input
        id={id}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="justify-between">
        {label}
        <code className="truncate font-mono text-[0.6875rem] font-normal text-muted-foreground">
          {path}
        </code>
      </Label>
      {control}
    </div>
  );
}

function JsonInput({ input, onChange }: { input: RiskData; onChange: (input: RiskData) => void }) {
  const [text, setText] = useState(() => JSON.stringify(input, null, 2));
  const [error, setError] = useState<string>();
  const id = useId();

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Risk data</Label>
      <Textarea
        id={id}
        value={text}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        className="min-h-72 font-mono text-[0.8125rem] leading-5"
        onChange={(event) => {
          setText(event.target.value);

          try {
            const parsed: unknown = JSON.parse(event.target.value);

            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
              setError("Enter a JSON object.");

              return;
            }

            setError(undefined);
            onChange(parsed as RiskData);
          } catch {
            setError("This isn't valid JSON yet.");
          }
        }}
      />
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function RunResult({ kind, run }: { kind: DecisionKind; run: SimulatorRun | undefined }) {
  if (!run) return null;

  if (run.status === "blocked") {
    return <Notice title="Can't run yet">Fix the highlighted cells to run the simulator.</Notice>;
  }

  if (run.status === "error") {
    return (
      <Notice tone="error" title={run.message}>
        {run.details && run.details.length > 0 && (
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {run.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }

  return <DecisionResultView kind={kind} result={run.result} durationMs={run.durationMs} />;
}

function matchedRows(node: NodeTrace): number[] | undefined {
  const data = node.traceData;

  if (data === undefined || node.type !== "decisionTableNode") return undefined;

  if (data === null) return [];

  const hits = Array.isArray(data) ? data : [data];

  return hits.flatMap((hit) => ("index" in hit ? [hit.index + 1] : []));
}

function TraceList({
  trace,
  tableNames,
}: {
  trace: DecisionTrace;
  tableNames: ReadonlyMap<string, string>;
}) {
  const nodes = Object.values(trace).filter(
    (node) => node.type !== "inputNode" && node.type !== "outputNode",
  );

  return (
    <section className="grid gap-3">
      <h3 className="m-0 text-sm font-medium">Why</h3>
      <ol className="m-0 grid list-none gap-px overflow-hidden rounded-lg border p-0">
        {nodes.map((node) => {
          const rows = matchedRows(node);

          return (
            <li key={node.id} className="grid gap-1 bg-card px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">
                  {tableNames.get(node.id) ?? node.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDuration(Number.parseFloat(node.performance))}
                </span>
              </div>
              {rows && (
                <p className="m-0 text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No rows matched."
                    : `${rows.length === 1 ? "Row" : "Rows"} ${rows.join(", ")} matched.`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <details className="group text-sm">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
          Node inputs and outputs
        </summary>
        <pre className="m-0 mt-2 max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
          {JSON.stringify(
            Object.fromEntries(
              nodes.map((node) => [node.name, { input: node.input, output: node.output }]),
            ),
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}

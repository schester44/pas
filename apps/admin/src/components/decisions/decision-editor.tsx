import {
  checkDecision,
  DECISION_KINDS,
  DecisionError,
  type DecisionIssue,
  type DecisionKind,
  type DecisionTableContent,
  evaluateDecision,
  type JdmDecision,
  type MatchedRule,
  parseJdm,
  readPaths,
} from "@pas/decisions-engine";
import type { RiskSchema } from "@pas/forms-core";
import { useExpressionsReady } from "@pas/forms-react";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { cn } from "@pas/ui/lib/utils";
import { useMemo, useState } from "react";
import { AddColumnMenu, DecisionTable, HIT_POLICIES, issueText, issueTone } from "./decision-table";
import { humanize, schemaPaths, tableNodes, updateTable } from "./jdm-edit";
import { SimulatorPanel, type SimulatorRun } from "./simulator";

const BLOCKING = new Set<DecisionIssue["code"]>([
  "invalid_jdm",
  "graph",
  "unsupported_node",
  "invalid_expression",
]);

type RiskData = Record<string, unknown>;

function simulate(kind: DecisionKind, value: JdmDecision, input: RiskData): SimulatorRun {
  try {
    const run = evaluateDecision(kind, value, input, { trace: true });

    return {
      status: "ok",
      result: run.result,
      raw: run.raw,
      trace: run.trace ?? {},
      durationMs: run.durationMs,
    };
  } catch (error) {
    if (error instanceof DecisionError && error.code === "contract_violation") {
      const issues = (error.details?.issues ?? []) as {
        row: number;
        path: string;
        message: string;
      }[];

      return {
        status: "error",
        message: "The result doesn't match the contract",
        details: issues.map(
          (issue) =>
            `Result ${issue.row + 1}${issue.path ? `, ${issue.path}` : ""}: ${issue.message}.`,
        ),
      };
    }

    return { status: "error", message: (error as Error).message };
  }
}

function matchedRules(run: SimulatorRun | undefined, nodeId: string | undefined) {
  if (run?.status !== "ok" || !nodeId) return undefined;

  const data = run.trace[nodeId]?.traceData;

  if (data === undefined) return new Set<string>();

  const hits = (Array.isArray(data) ? data : data ? [data] : []) as MatchedRule[];

  return new Set(hits.map((hit) => hit.ruleId));
}

export function DecisionEditor({
  kind,
  value,
  onChange,
  schema,
  readOnly,
  sample,
  input: controlled,
  onInputChange,
}: {
  kind: DecisionKind;
  value: JdmDecision;
  onChange: (value: JdmDecision) => void;
  schema: RiskSchema;
  readOnly?: boolean;
  sample?: RiskData;
  input?: RiskData;
  onInputChange?: (input: RiskData) => void;
}) {
  const ready = useExpressionsReady();
  const known = useMemo(() => schemaPaths(schema), [schema]);
  const [own, setOwn] = useState<RiskData>(sample ?? {});
  const input = controlled ?? own;
  const setInput = onInputChange ?? setOwn;
  const tables = tableNodes(value);
  const [activeId, setActiveId] = useState(tables[0]?.id);
  const active = tables.find((table) => table.id === activeId) ?? tables[0];

  const issues = useMemo(
    () => (ready ? checkDecision(kind, value, known) : []),
    [ready, kind, value, known],
  );

  const paths = useMemo(() => {
    if (!ready) return [];

    try {
      return readPaths(parseJdm(value));
    } catch {
      return [];
    }
  }, [ready, value]);

  const run = useMemo<SimulatorRun | undefined>(() => {
    if (!ready) return undefined;

    if (issues.some((issue) => BLOCKING.has(issue.code))) return { status: "blocked" };

    return simulate(kind, value, input);
  }, [ready, issues, kind, value, input]);

  const tableNames = new Map(tables.map((table) => [table.id, table.name]));

  if (!ready) return <div aria-hidden className="h-96 animate-pulse rounded-xl bg-muted/60" />;

  const nodeIssues = issues.filter((issue) => !active || issue.nodeId === active.id);

  const general = issues.filter(
    (issue) => !issue.nodeId || (active && issue.nodeId === active.id && !issue.columnId),
  );

  const content = active?.content as DecisionTableContent | undefined;

  const change = (next: DecisionTableContent) => {
    if (active) onChange(updateTable(value, active.id, () => next));
  };

  const errors = issues.filter((issue) => issueTone(issue) === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className="grid gap-6">
      {tables.length > 1 && (
        <SegmentedControl
          label="Table"
          className="w-fit"
          value={active?.id ?? ""}
          onValueChange={setActiveId}
          options={tables.map((table) => ({ value: table.id, label: table.name }))}
        />
      )}
      <Panel
        flush
        title={active?.name ?? "Decision"}
        description={
          content && (
            <>
              {DECISION_KINDS[kind].label} · {readOnly && `${HIT_POLICIES[content.hitPolicy]} · `}
              <span className="tabular-nums">
                {content.rules.length} {content.rules.length === 1 ? "row" : "rows"}
              </span>
              {issues.length > 0 && (
                <span className={cn(errors > 0 ? "text-destructive" : "text-amber-900")}>
                  {" · "}
                  {[
                    errors > 0 && `${errors} ${errors === 1 ? "error" : "errors"}`,
                    warnings > 0 && `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              )}
            </>
          )
        }
        action={
          content &&
          !readOnly && (
            <div className="flex items-center gap-2">
              <Select
                value={content.hitPolicy}
                onValueChange={(hitPolicy) =>
                  change({ ...content, hitPolicy: hitPolicy as DecisionTableContent["hitPolicy"] })
                }
              >
                <SelectTrigger size="sm" className="w-36" aria-label="Hit policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="first" description="Stop at the first matching row.">
                    First match
                  </SelectItem>
                  <SelectItem value="collect" description="Return every matching row.">
                    Collect all
                  </SelectItem>
                </SelectContent>
              </Select>
              <AddColumnMenu kind={kind} content={content} onChange={change} />
            </div>
          )
        }
      >
        {general.length > 0 && (
          <ul className="m-0 grid list-none divide-y border-b p-0">
            {general.map((issue, i) => (
              <li
                key={`${issue.code}-${issue.path ?? i}`}
                className="flex items-center gap-2 px-(--card-p) py-2.5 text-sm"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    issueTone(issue) === "error" ? "bg-red-500" : "bg-amber-500",
                  )}
                />
                <span
                  className={issueTone(issue) === "error" ? "text-foreground" : "text-amber-900"}
                >
                  {issueText(issue)}
                </span>
                {issue.code === "missing_output" && issue.path && content && !readOnly && (
                  <button
                    type="button"
                    className="ml-auto text-sm font-medium text-primary hover:underline"
                    onClick={() =>
                      change({
                        ...content,
                        outputs: [
                          ...content.outputs,
                          {
                            id: crypto.randomUUID(),
                            name: humanize(issue.path!),
                            field: issue.path!,
                          },
                        ],
                      })
                    }
                  >
                    Add column
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {active ? (
          <DecisionTable
            kind={kind}
            node={active}
            schema={schema}
            issues={nodeIssues}
            matched={matchedRules(run, active.id)}
            readOnly={readOnly}
            onChange={change}
          />
        ) : (
          <p className="m-0 px-(--card-p) py-10 text-center text-sm text-muted-foreground">
            This decision has no tables to edit.
          </p>
        )}
      </Panel>
      <SimulatorPanel
        kind={kind}
        schema={schema}
        paths={paths}
        input={input}
        onInputChange={setInput}
        run={run}
        tableNames={tableNames}
      />
    </div>
  );
}

import { indexSchema, type RiskSchema } from "@pas/forms-core";
import type { CoverageAlgorithm, Operand, RatingPlan, Step, StepOp } from "@pas/rating-engine/plan";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
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
import { cn } from "@pas/ui/lib/utils";
import { ArrowDown, ArrowUp, Ellipsis, Plus, Trash2, X } from "lucide-react";
import { useId, useMemo } from "react";
import type { Coverage } from "@/components/catalog/version-editor";
import { humanize } from "@/components/decisions/jdm-edit";
import {
  describeOperand,
  newStep,
  type OperandOption,
  operandOptions,
  STEP_OP_ORDER,
  STEP_OPS,
  uniqueName,
} from "./model";
import { OperandPicker } from "./operand-picker";
import type { RatingIssue } from "./use-rating";
import { readable } from "@/lib/readable";

const ROUNDING = { half_up: "Half up", half_even: "Half even", up: "Up", down: "Down" } as const;

function operandsOf(step: Step): Operand[] {
  switch (step.op) {
    case "lookup":
      return step.keys;
    case "multiply":
    case "add":
    case "min":
    case "max":
      return step.operands;
    case "subtract":
      return [step.left, step.right];
    case "cap":
      return [step.value, step.max];
    case "floor":
      return [step.value, step.min];
    case "round":
      return [step.value];
    case "if":
      return [step.whenTrue, step.whenFalse];
    default:
      return [];
  }
}

function exposureNoun(schema: RiskSchema, exposure: string): string {
  const node = indexSchema(schema).get(exposure.replace(/\[\]$/, ""));

  return humanize(
    (node && "exposure" in node && node.exposure) || node?.label || exposure,
  ).toLowerCase();
}

export function summarizeStep(step: Step, options: readonly OperandOption[]): string {
  const label = (operand: Operand | undefined) =>
    operand ? describeOperand(operand, options).label : "?";

  const list = (separator: string) => operandsOf(step).map(label).join(separator) || "Nothing yet";

  switch (step.op) {
    case "lookup":
      return `${step.table || "No table"} · ${step.keys.map(label).join(" × ") || "no keys"}`;
    case "multiply":
      return list(" × ");
    case "add":
      return list(" + ");
    case "min":
    case "max":
      return list(", ");
    case "subtract":
      return `${label(step.left)} − ${label(step.right)}`;
    case "cap":
      return `${label(step.value)}, at most ${label(step.max)}`;
    case "floor":
      return `${label(step.value)}, at least ${label(step.min)}`;
    case "round":
      return `${label(step.value)} to ${step.places} ${step.places === 1 ? "place" : "places"}`;
    case "expression":
      return step.expression || "No formula yet";
    case "if":
      return `${step.condition || "?"} ? ${label(step.whenTrue)} : ${label(step.whenFalse)}`;
    case "sumCoverages":
      return step.coverages.join(" + ") || "No coverages";
  }
}

export function AlgorithmEditor({
  algorithm,
  coverage,
  plan,
  schema,
  coverages,
  issues,
  readOnly,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  algorithm: CoverageAlgorithm;
  coverage: Coverage | undefined;
  plan: RatingPlan;
  schema: RiskSchema;
  coverages: readonly Coverage[];
  issues: RatingIssue[];
  readOnly: boolean;
  selected: number;
  onSelect: (index: number) => void;
  onChange: (algorithm: CoverageAlgorithm) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const steps = algorithm.steps;
  const index = Math.min(selected, steps.length - 1);
  const step = steps[index];

  const general = issues.filter((issue) => !issue.target.step);
  const stepIssues = (name: string) => issues.filter((issue) => issue.target.step === name);

  const setSteps = (next: Step[]) => onChange({ ...algorithm, steps: next });

  const setStep = (i: number, next: Step) => {
    const previous = steps[i]!;

    onChange({
      ...algorithm,
      steps: steps.map((s, j) => (j === i ? next : renameRefs(s, previous.name, next.name))),
      premium: algorithm.premium === previous.name ? next.name : algorithm.premium,
    });
  };

  const add = (op: StepOp) => {
    const name = uniqueName(
      op === "lookup" ? "rate" : op,
      steps.map((s) => s.name),
    );

    setSteps([...steps, newStep(op, name)]);
    onSelect(steps.length);
  };

  const move = (by: number) => {
    const target = index + by;

    if (target < 0 || target >= steps.length) return;

    const next = [...steps];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    setSteps(next);
    onSelect(target);
  };

  const allOptions = useMemo(
    () => operandOptions(schema, coverages, algorithm, steps),
    [schema, coverages, algorithm, steps],
  );

  return (
    <Panel
      flush
      title={coverage?.name ?? algorithm.coverage}
      description={
        <>
          {algorithm.exposure
            ? `Rated for each ${exposureNoun(schema, algorithm.exposure)}`
            : "Rated once per policy"}
          {" · "}
          <span className="tabular-nums">
            {steps.length} {steps.length === 1 ? "step" : "steps"}
          </span>
        </>
      }
      action={
        !readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" aria-label="Algorithm actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRemove} className="text-destructive">
                Remove algorithm
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    >
      {general.length > 0 && <IssueList issues={general} />}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:divide-x">
        <div className="grid content-start">
          <ol className="m-0 grid list-none gap-0.5 p-2">
            {steps.map((s, i) => {
              const problems = stepIssues(s.name);

              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onSelect(i)}
                    aria-current={i === index || undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                      i === index ? "bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
                        i === index
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {s.label || humanize(s.name)}
                        </span>
                        {STEP_OPS[s.op].label.toLowerCase() !==
                          (s.label || humanize(s.name)).toLowerCase() && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {STEP_OPS[s.op].label}
                          </span>
                        )}
                        {algorithm.premium === s.name && (
                          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary">
                            Premium
                          </span>
                        )}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {summarizeStep(s, allOptions)}
                      </span>
                    </span>
                    {problems.length > 0 && (
                      <span
                        aria-label={`${problems.length} issues`}
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          {!readOnly && (
            <div className="px-2 pb-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Plus /> Add step
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {STEP_OP_ORDER.map((op) => (
                    <DropdownMenuItem key={op} onSelect={() => add(op)}>
                      <span className="grid gap-0.5">
                        <span className="text-sm">{STEP_OPS[op].label}</span>
                        <span className="text-xs text-muted-foreground">
                          {STEP_OPS[op].description}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <div className="grid gap-4 border-t bg-muted/30 px-(--card-p) py-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-premium`}>Premium step</Label>
              <Select
                value={algorithm.premium}
                disabled={readOnly}
                onValueChange={(premium) => onChange({ ...algorithm, premium })}
              >
                <SelectTrigger id={`${id}-premium`}>
                  <SelectValue placeholder="Choose a step" />
                </SelectTrigger>
                <SelectContent>
                  {steps.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.label || humanize(s.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-minimum`}>
                Minimum premium <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              <Input
                id={`${id}-minimum`}
                inputMode="decimal"
                className="tabular-nums"
                readOnly={readOnly}
                value={algorithm.minimumPremium ?? ""}
                onChange={(event) => {
                  const { minimumPremium: _, ...rest } = algorithm;
                  const value = event.target.value.trim();

                  onChange(value ? { ...rest, minimumPremium: value } : rest);
                }}
              />
            </div>
          </div>
        </div>
        {step && (
          <StepInspector
            key={index}
            step={step}
            plan={plan}
            coverages={coverages}
            options={operandOptions(schema, coverages, algorithm, steps.slice(0, index))}
            issues={stepIssues(step.name)}
            readOnly={readOnly}
            canMoveUp={index > 0}
            canMoveDown={index < steps.length - 1}
            onChange={(next) => setStep(index, next)}
            onMove={move}
            onDelete={
              steps.length > 1
                ? () => {
                    setSteps(steps.filter((_, j) => j !== index));
                    onSelect(Math.max(0, index - 1));
                  }
                : undefined
            }
          />
        )}
      </div>
    </Panel>
  );
}

function renameRefs(step: Step, from: string, to: string): Step {
  if (from === to) return step;

  const fix = (operand: Operand): Operand =>
    "step" in operand && operand.step === from ? { step: to } : operand;

  switch (step.op) {
    case "lookup":
      return { ...step, keys: step.keys.map(fix) };
    case "multiply":
    case "add":
    case "min":
    case "max":
      return { ...step, operands: step.operands.map(fix) };
    case "subtract":
      return { ...step, left: fix(step.left), right: fix(step.right) };
    case "cap":
      return { ...step, value: fix(step.value), max: fix(step.max) };
    case "floor":
      return { ...step, value: fix(step.value), min: fix(step.min) };
    case "round":
      return { ...step, value: fix(step.value) };
    case "if":
      return { ...step, whenTrue: fix(step.whenTrue), whenFalse: fix(step.whenFalse) };
    default:
      return step;
  }
}

function IssueList({ issues }: { issues: RatingIssue[] }) {
  return (
    <ul className="m-0 grid list-none divide-y border-b p-0">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-center gap-2 px-(--card-p) py-2.5 text-sm">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-red-500" />
          {readable(issue.message)}
        </li>
      ))}
    </ul>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function StepInspector({
  step,
  plan,
  coverages,
  options,
  issues,
  readOnly,
  canMoveUp,
  canMoveDown,
  onChange,
  onMove,
  onDelete,
}: {
  step: Step;
  plan: RatingPlan;
  coverages: readonly Coverage[];
  options: OperandOption[];
  issues: RatingIssue[];
  readOnly: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (step: Step) => void;
  onMove: (by: number) => void;
  onDelete: (() => void) | undefined;
}) {
  const id = useId();
  const table = step.op === "lookup" ? plan.tables.find((t) => t.key === step.table) : undefined;

  const operand = (label: string, value: Operand, set: (operand: Operand) => void) => (
    <Field label={label}>
      <OperandPicker value={value} options={options} disabled={readOnly} onChange={set} />
    </Field>
  );

  return (
    <aside className="grid min-w-0 content-start gap-5 border-t p-(--card-p) lg:border-t-0">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <Field label="Label" htmlFor={`${id}-label`}>
          <Input
            id={`${id}-label`}
            value={step.label ?? ""}
            readOnly={readOnly}
            onChange={(event) => onChange({ ...step, label: event.target.value })}
          />
        </Field>
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={step.name}
            readOnly={readOnly}
            className="font-mono"
            onChange={(event) =>
              onChange({ ...step, name: event.target.value.replace(/[^A-Za-z0-9_]/g, "_") })
            }
          />
        </Field>
      </div>

      {step.op === "lookup" && (
        <>
          <Field label="Table">
            <Select
              value={step.table}
              disabled={readOnly}
              onValueChange={(key) => {
                const next = plan.tables.find((t) => t.key === key);
                const keys = next?.dimensions.map((_, i) => step.keys[i] ?? { value: "" }) ?? [];

                onChange({ ...step, table: key, keys });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a table" />
              </SelectTrigger>
              <SelectContent>
                {plan.tables.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    <code className="font-mono">{t.key}</code>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {table?.dimensions.map((dimension, i) => (
            <Field key={i} label={humanize(dimension.name)}>
              <OperandPicker
                value={step.keys[i]}
                options={options}
                disabled={readOnly}
                onChange={(key) => {
                  const keys = [...step.keys];
                  keys[i] = key;
                  onChange({ ...step, keys });
                }}
              />
            </Field>
          ))}
        </>
      )}

      {(step.op === "multiply" || step.op === "add" || step.op === "min" || step.op === "max") && (
        <Field label="Values">
          <div className="grid gap-2">
            {step.operands.map((value, i) => (
              <div key={i} className="flex items-center gap-1">
                <OperandPicker
                  value={value}
                  options={options}
                  disabled={readOnly}
                  onChange={(next) =>
                    onChange({
                      ...step,
                      operands: step.operands.map((o, j) => (j === i ? next : o)),
                    })
                  }
                />
                {!readOnly && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label="Remove value"
                    onClick={() =>
                      onChange({ ...step, operands: step.operands.filter((_, j) => j !== i) })
                    }
                  >
                    <X />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <OperandPicker
                value={undefined}
                options={options}
                placeholder="Add a value"
                onChange={(next) => onChange({ ...step, operands: [...step.operands, next] })}
              />
            )}
          </div>
        </Field>
      )}

      {step.op === "subtract" && (
        <>
          {operand("From", step.left, (left) => onChange({ ...step, left }))}
          {operand("Take away", step.right, (right) => onChange({ ...step, right }))}
        </>
      )}

      {step.op === "cap" && (
        <>
          {operand("Value", step.value, (value) => onChange({ ...step, value }))}
          {operand("At most", step.max, (max) => onChange({ ...step, max }))}
        </>
      )}

      {step.op === "floor" && (
        <>
          {operand("Value", step.value, (value) => onChange({ ...step, value }))}
          {operand("At least", step.min, (min) => onChange({ ...step, min }))}
        </>
      )}

      {step.op === "round" && (
        <>
          {operand("Value", step.value, (value) => onChange({ ...step, value }))}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rounding">
              <Select
                value={step.mode}
                disabled={readOnly}
                onValueChange={(mode) => onChange({ ...step, mode: mode as typeof step.mode })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROUNDING).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Places" htmlFor={`${id}-places`}>
              <Input
                id={`${id}-places`}
                type="number"
                min={0}
                max={10}
                className="tabular-nums"
                readOnly={readOnly}
                value={step.places}
                onChange={(event) =>
                  onChange({ ...step, places: Math.max(0, Number(event.target.value) || 0) })
                }
              />
            </Field>
          </div>
        </>
      )}

      {(step.op === "expression" || step.op === "if") && (
        <Field label={step.op === "if" ? "Condition" : "Formula"} htmlFor={`${id}-expression`}>
          <Textarea
            id={`${id}-expression`}
            spellCheck={false}
            readOnly={readOnly}
            className="min-h-20 font-mono text-[0.8125rem] leading-5"
            placeholder={
              step.op === "if" ? "exposure.hasSumpPump == true" : "coverage.limit / 1000"
            }
            value={step.op === "if" ? step.condition : step.expression}
            onChange={(event) =>
              onChange(
                step.op === "if"
                  ? { ...step, condition: event.target.value }
                  : { ...step, expression: event.target.value },
              )
            }
          />
        </Field>
      )}

      {step.op === "if" && (
        <>
          {operand("When true", step.whenTrue, (whenTrue) => onChange({ ...step, whenTrue }))}
          {operand("Otherwise", step.whenFalse, (whenFalse) => onChange({ ...step, whenFalse }))}
        </>
      )}

      {step.op === "sumCoverages" && (
        <>
          <Field label="Coverages">
            <div className="grid gap-2 rounded-lg border p-3">
              {coverages.map((coverage) => (
                <Label key={coverage.code} className="font-normal">
                  <Checkbox
                    disabled={readOnly}
                    checked={step.coverages.includes(coverage.code)}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...step,
                        coverages: checked
                          ? [...step.coverages, coverage.code]
                          : step.coverages.filter((code) => code !== coverage.code),
                      })
                    }
                  />
                  {coverage.name}
                </Label>
              ))}
            </div>
          </Field>
          <Field label="Scope">
            <SegmentedControl
              label="Scope"
              className="w-fit"
              value={step.scope}
              onValueChange={(scope) => onChange({ ...step, scope })}
              options={[
                { value: "exposure", label: "Same exposure" },
                { value: "policy", label: "Whole policy" },
              ]}
            />
          </Field>
        </>
      )}

      {issues.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0 text-sm text-red-700">
          {issues.map((issue, i) => (
            <li key={i}>{readable(issue.message)}</li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex items-center gap-1 border-t pt-4">
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Move step up"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Move step down"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-destructive"
              onClick={onDelete}
            >
              <Trash2 /> Delete step
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}

import type { RiskSchema } from "@pas/forms-core";
import type { RateTable, RatingPlan } from "@pas/rating-engine/plan";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
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
import { cn } from "@pas/ui/lib/utils";
import { Plus, Sigma } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import type { RatingSearch } from "@/components/catalog/issues";
import type { Coverage } from "@/components/catalog/version-editor";
import { AlgorithmEditor } from "./algorithm-editor";
import { newAlgorithm } from "./model";
import { TableEditor } from "./table-editor";
import type { RatingIssue } from "./use-rating";
import { readable } from "@/lib/readable";

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function PlanEditor({
  plan,
  schema,
  coverages,
  issues,
  readOnly,
  search,
  onNavigate,
  onChange,
  worksheet,
}: {
  plan: RatingPlan;
  schema: RiskSchema;
  coverages: readonly Coverage[];
  issues: RatingIssue[];
  readOnly: boolean;
  search: RatingSearch;
  onNavigate: (search: RatingSearch) => void;
  onChange: (plan: RatingPlan) => void;
  worksheet: (focus: string | undefined) => React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState(0);

  const table = search.table ? plan.tables.find((t) => t.key === search.table) : undefined;

  const coverageCode =
    search.settings || table ? undefined : (search.coverage ?? coverages[0]?.code);

  const coverage = coverages.find((c) => c.code === coverageCode);
  const algorithm = plan.algorithms.find((a) => a.coverage === coverageCode);

  const tableIssues = (key: string) =>
    issues.filter((issue) => issue.target.section === "tables" && issue.target.table === key);

  const coverageIssues = (code: string) =>
    issues.filter(
      (issue) => issue.target.section === "algorithms" && issue.target.coverage === code,
    );

  const engineIssues = issues.filter((issue) => issue.target.section === "engine");

  const setTables = (tables: RateTable[]) => onChange({ ...plan, tables });

  const select = (next: RatingSearch) => {
    setStep(0);
    onNavigate({ section: "rater", ...next });
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Panel flush className="lg:sticky lg:top-20">
        <Nav title="Algorithms">
          {coverages.map((c) => {
            const rated = plan.algorithms.find((a) => a.coverage === c.code);

            return (
              <NavItem
                key={c.code}
                active={c.code === coverageCode}
                problem={coverageIssues(c.code).length > 0}
                onClick={() => select({ coverage: c.code })}
                title={c.name}
                meta={
                  rated
                    ? `${rated.steps.length} ${rated.steps.length === 1 ? "step" : "steps"}`
                    : "Not rated yet"
                }
              />
            );
          })}
        </Nav>
        <Nav
          title="Rate tables"
          action={
            !readOnly && (
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-muted-foreground"
                aria-label="Add table"
                onClick={() => setAdding(true)}
              >
                <Plus />
              </Button>
            )
          }
        >
          {plan.tables.length === 0 && (
            <p className="m-0 px-2.5 py-1 text-xs text-muted-foreground">No tables yet.</p>
          )}
          {plan.tables.map((t) => (
            <NavItem
              key={t.key}
              active={t.key === table?.key}
              problem={tableIssues(t.key).length > 0}
              onClick={() => select({ table: t.key })}
              title={<code className="font-mono text-[0.8125rem]">{t.key}</code>}
              meta={`${t.rows.length} ${t.rows.length === 1 ? "row" : "rows"} · ${t.dimensions.map((d) => d.name).join(" × ")}`}
            />
          ))}
        </Nav>
        <Nav title="Plan">
          <NavItem
            active={!!search.settings}
            problem={engineIssues.length > 0}
            onClick={() => select({ settings: true })}
            title="Rounding and minimums"
            meta={`${plan.currency} · ${plan.rounding.places} places`}
          />
        </Nav>
      </Panel>

      <div className="grid min-w-0 gap-6">
        {table ? (
          <TableEditor
            key={table.key}
            table={table}
            issues={tableIssues(table.key)}
            readOnly={readOnly}
            onChange={(next) => setTables(plan.tables.map((t) => (t === table ? next : t)))}
            onDelete={() => {
              setTables(plan.tables.filter((t) => t !== table));
              select({});
            }}
          />
        ) : search.settings ? (
          <PlanSettings plan={plan} issues={engineIssues} readOnly={readOnly} onChange={onChange} />
        ) : algorithm ? (
          <AlgorithmEditor
            key={algorithm.coverage}
            algorithm={algorithm}
            coverage={coverage}
            plan={plan}
            schema={schema}
            coverages={coverages}
            issues={coverageIssues(algorithm.coverage)}
            readOnly={readOnly}
            selected={step}
            onSelect={setStep}
            onChange={(next) =>
              onChange({
                ...plan,
                algorithms: plan.algorithms.map((a) => (a === algorithm ? next : a)),
              })
            }
            onRemove={() =>
              onChange({ ...plan, algorithms: plan.algorithms.filter((a) => a !== algorithm) })
            }
          />
        ) : coverage ? (
          <Panel>
            <EmptyState
              icon={<Sigma />}
              title={`${coverage.name} isn't rated yet`}
              description="Add an algorithm: the steps that turn the risk into this coverage's premium."
              action={
                !readOnly && (
                  <Button
                    size="sm"
                    onClick={() =>
                      onChange({
                        ...plan,
                        algorithms: [...plan.algorithms, newAlgorithm(coverage)],
                      })
                    }
                  >
                    <Plus /> Add algorithm
                  </Button>
                )
              }
            />
          </Panel>
        ) : null}
        {worksheet(table || search.settings ? undefined : coverageCode)}
      </div>
      <AddTableDialog
        open={adding}
        onOpenChange={setAdding}
        taken={plan.tables.map((t) => t.key)}
        onAdd={(key) => {
          setTables([
            ...plan.tables,
            { key, dimensions: [{ name: "key", match: "exact" }], rows: [] },
          ]);

          select({ table: key });
        }}
      />
    </div>
  );
}

function Nav({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-1 border-b py-3 last:border-b-0">
      <header className="flex h-7 items-center justify-between px-(--card-p) pr-3">
        <h3 className="m-0 text-xs font-medium text-muted-foreground">{title}</h3>
        {action}
      </header>
      <ul className="m-0 grid list-none gap-0.5 px-2">{children}</ul>
    </section>
  );
}

function NavItem({
  active,
  problem,
  title,
  meta,
  onClick,
}: {
  active: boolean;
  problem: boolean;
  title: React.ReactNode;
  meta: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active || undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
          active ? "bg-primary/5" : "hover:bg-muted/60",
        )}
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        </span>
        {problem && (
          <span aria-label="Has issues" className="size-1.5 shrink-0 rounded-full bg-red-500" />
        )}
      </button>
    </li>
  );
}

function PlanSettings({
  plan,
  issues,
  readOnly,
  onChange,
}: {
  plan: RatingPlan;
  issues: RatingIssue[];
  readOnly: boolean;
  onChange: (plan: RatingPlan) => void;
}) {
  const id = useId();

  return (
    <Panel title="Rounding and minimums" description="Applied after every coverage is rated.">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-currency`}>Currency</Label>
          <Input
            id={`${id}-currency`}
            value={plan.currency}
            maxLength={3}
            readOnly={readOnly}
            className="w-24 uppercase"
            onChange={(event) => onChange({ ...plan, currency: event.target.value.toUpperCase() })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-minimum`}>
            Policy minimum premium{" "}
            <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id={`${id}-minimum`}
            inputMode="decimal"
            className="w-40 tabular-nums"
            readOnly={readOnly}
            value={plan.minimumPremium ?? ""}
            onChange={(event) => {
              const { minimumPremium: _, ...rest } = plan;
              const value = event.target.value.trim();

              onChange(value ? { ...rest, minimumPremium: value } : rest);
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label>Round premiums</Label>
          <Select
            value={plan.rounding.mode}
            disabled={readOnly}
            onValueChange={(mode) =>
              onChange({
                ...plan,
                rounding: { ...plan.rounding, mode: mode as typeof plan.rounding.mode },
              })
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="half_up">Half up</SelectItem>
              <SelectItem value="half_even">Half even</SelectItem>
              <SelectItem value="up">Up</SelectItem>
              <SelectItem value="down">Down</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-places`}>Decimal places</Label>
          <Input
            id={`${id}-places`}
            type="number"
            min={0}
            max={10}
            className="w-24 tabular-nums"
            readOnly={readOnly}
            value={plan.rounding.places}
            onChange={(event) =>
              onChange({
                ...plan,
                rounding: {
                  ...plan.rounding,
                  places: Math.max(0, Number(event.target.value) || 0),
                },
              })
            }
          />
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="m-0 mt-5 grid list-none gap-1 p-0 text-sm text-red-700">
          {issues.map((issue, i) => (
            <li key={i}>{readable(issue.message)}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AddTableDialog({
  open,
  onOpenChange,
  taken,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taken: string[];
  onAdd: (key: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <AddTableForm
            taken={taken}
            onAdd={(key) => {
              onAdd(key);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddTableForm({ taken, onAdd }: { taken: string[]; onAdd: (key: string) => void }) {
  const id = useId();
  const [key, setKey] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const error = !NAME.test(key)
    ? "Use letters, digits and _, like base_rate"
    : taken.includes(key)
      ? `There's already a table called ${key}`
      : null;

  return (
    <form
      className="grid gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);

        if (!error) onAdd(key);
      }}
    >
      <DialogHeader>
        <DialogTitle>Add rate table</DialogTitle>
        <DialogDescription>
          Steps look up rates and factors by key. Add dimensions and rows once it's created, or
          import them from CSV.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={id}>Key</Label>
        <Input
          id={id}
          value={key}
          autoFocus
          placeholder="base_rate"
          className="font-mono"
          aria-invalid={submitted && !!error}
          onChange={(event) => setKey(event.target.value.trim())}
        />
        {submitted && error && <p className="m-0 text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit">Add table</Button>
      </DialogFooter>
    </form>
  );
}

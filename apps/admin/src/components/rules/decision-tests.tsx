import type { DecisionKind } from "@pas/decisions-engine";
import { useExpressionsReady } from "@pas/forms-react";
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
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Panel } from "@pas/ui/components/panel";
import { cn } from "@pas/ui/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { DecisionTest, VersionDecision } from "@/components/catalog/version-editor";
import { newId } from "@/components/decisions/jdm-edit";
import { evaluate, runTest, summarize } from "./rules";

export function DecisionTests({
  decision,
  input,
  readOnly,
  onLoad,
  onChange,
}: {
  decision: VersionDecision;
  input: Record<string, unknown>;
  readOnly: boolean;
  onLoad: (input: Record<string, unknown>) => void;
  onChange: (tests: DecisionTest[]) => void;
}) {
  const ready = useExpressionsReady();
  const [saving, setSaving] = useState(false);
  const kind = decision.kind as DecisionKind;
  const tests = decision.tests;
  const runs = ready ? tests.map((test) => runTest(decision, test)) : [];
  const passing = runs.filter((run) => run.passed).length;
  const current = ready ? evaluate(kind, decision.decision, input) : undefined;

  const update = (id: string, patch: Partial<DecisionTest>) =>
    onChange(tests.map((test) => (test.id === id ? { ...test, ...patch } : test)));

  return (
    <Panel
      flush
      title="Tests"
      description={
        tests.length === 0 ? (
          "Save a simulator input with the result it must return. Publishing runs every test."
        ) : (
          <span className="tabular-nums">
            {passing === tests.length
              ? `All ${tests.length} passing`
              : `${tests.length - passing} of ${tests.length} failing`}
          </span>
        )
      }
      action={
        !readOnly && (
          <Button
            size="sm"
            variant="outline"
            disabled={current?.status !== "ok"}
            onClick={() => setSaving(true)}
          >
            <Plus /> Save as test
          </Button>
        )
      }
    >
      {tests.length > 0 && (
        <ul className="m-0 grid list-none divide-y p-0">
          {tests.map((test, i) => {
            const run = runs[i];
            const failed = run && !run.passed;

            return (
              <li
                key={test.id}
                className="flex items-center gap-3 px-(--card-p) py-3 transition-colors hover:bg-muted/30"
              >
                <span
                  aria-label={run ? (run.passed ? "Passing" : "Failing") : undefined}
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    !run ? "bg-muted" : run.passed ? "bg-emerald-500" : "bg-red-500",
                  )}
                />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-medium">{test.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Expects {summarize(kind, test.expected)}
                    {failed && (
                      <span className="text-red-700">
                        {" · "}
                        {run.actual.status === "ok"
                          ? `returns ${summarize(kind, run.actual.result)}`
                          : run.actual.message}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onLoad(test.input)}>
                    Load input
                  </Button>
                  {failed && !readOnly && run.actual.status === "ok" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        update(test.id, {
                          expected: run.actual.status === "ok" ? run.actual.result : null,
                        })
                      }
                    >
                      Accept result
                    </Button>
                  )}
                  {!readOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${test.name}`}
                      className="size-8 text-muted-foreground"
                      onClick={() => onChange(tests.filter((t) => t.id !== test.id))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <SaveTestDialog
        open={saving}
        onOpenChange={setSaving}
        summary={current?.status === "ok" ? summarize(kind, current.result) : ""}
        suggested={`Case ${tests.length + 1}`}
        onSave={(name) => {
          if (current?.status !== "ok") return;

          onChange([
            ...tests,
            { id: newId(), name, input: structuredClone(input), expected: current.result },
          ]);
        }}
      />
    </Panel>
  );
}

function SaveTestDialog({
  open,
  onOpenChange,
  summary,
  suggested,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: string;
  suggested: string;
  onSave: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <SaveTestForm
            summary={summary}
            suggested={suggested}
            onSave={(name) => {
              onSave(name);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SaveTestForm({
  summary,
  suggested,
  onSave,
}: {
  summary: string;
  suggested: string;
  onSave: (name: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(name.trim() || suggested);
      }}
    >
      <DialogHeader>
        <DialogTitle>Save as test</DialogTitle>
        <DialogDescription>
          The simulator input must keep returning <span className="text-foreground">{summary}</span>
          .
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={id}>Name</Label>
        <Input
          id={id}
          value={name}
          autoFocus
          placeholder={suggested}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit">Save test</Button>
      </DialogFooter>
    </form>
  );
}

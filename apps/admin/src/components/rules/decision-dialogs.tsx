import { DECISION_KINDS, type DecisionKind } from "@pas/decisions-engine";
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
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { useId, useState } from "react";
import type { VersionDecision } from "@/components/catalog/version-editor";
import { blankDecision, KIND_COPY, KIND_ORDER } from "./rules";

const KEY = /^[a-z][a-z0-9_]*$/;

export function AddDecisionDialog({
  open,
  onOpenChange,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: VersionDecision[];
  onAdd: (decision: VersionDecision) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open && (
          <AddDecisionForm
            existing={existing}
            onAdd={(decision) => {
              onAdd(decision);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddDecisionForm({
  existing,
  onAdd,
}: {
  existing: VersionDecision[];
  onAdd: (decision: VersionDecision) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<DecisionKind>("underwriting");

  const freeKey = (forKind: DecisionKind) => {
    const taken = new Set(existing.filter((d) => d.kind === forKind).map((d) => d.key));
    let n = 1;

    while (taken.has(n === 1 ? "main" : `main_${n}`)) n++;

    return n === 1 ? "main" : `main_${n}`;
  };

  const [key, setKey] = useState(() => freeKey("underwriting"));
  const [keyEdited, setKeyEdited] = useState(false);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const keyError = !KEY.test(key)
    ? "Use lowercase letters, digits and _"
    : existing.some((d) => d.kind === kind && d.key === key)
      ? `There's already a ${DECISION_KINDS[kind].label.toLowerCase()} decision called ${key}`
      : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);

    if (keyError) return;

    const title = name.trim() || DECISION_KINDS[kind].label;

    onAdd({ kind, key, name: title, decision: blankDecision(kind, title), tests: [] });
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <DialogHeader>
        <DialogTitle>Add decision</DialogTitle>
        <DialogDescription>
          Each kind returns a fixed result the platform acts on.
        </DialogDescription>
      </DialogHeader>
      <RadioGroup
        value={kind}
        onValueChange={(next) => {
          setKind(next as DecisionKind);

          if (!keyEdited) setKey(freeKey(next as DecisionKind));
        }}
        aria-label="Kind"
        className="grid gap-0 overflow-hidden rounded-lg border sm:grid-cols-2"
      >
        {KIND_ORDER.map((option) => (
          <label
            key={option}
            htmlFor={`${id}-${option}`}
            className="flex cursor-pointer items-start gap-3 border-b px-3.5 py-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:bg-primary/5 sm:odd:border-r"
          >
            <RadioGroupItem id={`${id}-${option}`} value={option} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{DECISION_KINDS[option].label}</span>
              <span className="text-xs text-muted-foreground">{KIND_COPY[option]}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-name`}>
            Name <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Input
            id={`${id}-name`}
            value={name}
            placeholder={DECISION_KINDS[kind].label}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-key`}>Key</Label>
          <Input
            id={`${id}-key`}
            value={key}
            className="font-mono"
            aria-invalid={submitted && !!keyError}
            onChange={(event) => {
              setKeyEdited(true);
              setKey(event.target.value.trim());
            }}
          />
          {submitted && keyError && <p className="m-0 text-sm text-destructive">{keyError}</p>}
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit">Add decision</Button>
      </DialogFooter>
    </form>
  );
}

export function RenameDecisionDialog({
  decision,
  onOpenChange,
  onRename,
}: {
  decision: VersionDecision | undefined;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => void;
}) {
  return (
    <Dialog open={!!decision} onOpenChange={onOpenChange}>
      <DialogContent>
        {decision && (
          <RenameForm
            initial={decision.name}
            onRename={(name) => {
              onRename(name);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ initial, onRename }: { initial: string; onRename: (name: string) => void }) {
  const id = useId();
  const [name, setName] = useState(initial);

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();

        if (name.trim()) onRename(name.trim());
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename decision</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={id}>Name</Label>
        <Input id={id} value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={!name.trim()}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}

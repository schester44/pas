import type { ActionField, DisplayBlock, ExtensionSurface } from "@pas/extension-points";
import { useEffect, useState } from "react";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { ExtensionBlocks } from "./extension-blocks";
import { Input } from "./input";
import { Label } from "./label";
import { Notice } from "./notice";
import { Panel } from "./panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Spinner } from "./spinner";

export interface ActionOutcome {
  message: string | null;
  blocks: DisplayBlock[];
  applied?: string[];
}

interface Props {
  surfaces: readonly ExtensionSurface[];
  loadPanel: (bindingId: string) => Promise<DisplayBlock[] | null>;
  runAction: (bindingId: string, values: Record<string, unknown>) => Promise<ActionOutcome>;
  canAct: boolean;
  onActionDone?: (outcome: ActionOutcome) => void;
}

function ExtensionPanel({
  surface,
  load,
}: {
  surface: ExtensionSurface;
  load: Props["loadPanel"];
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; blocks: DisplayBlock[] | null }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    load(surface.bindingId).then(
      (blocks) => !cancelled && setState({ status: "ready", blocks }),
      (error: unknown) =>
        !cancelled &&
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => {
      cancelled = true;
    };
  }, [load, surface.bindingId]);

  return (
    <Panel title={surface.label}>
      {state.status === "loading" ? (
        <div className="grid gap-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted/60" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted/60" />
        </div>
      ) : state.status === "error" ? (
        <p className="m-0 text-sm text-muted-foreground">
          Couldn't load this panel. {state.message}
        </p>
      ) : state.blocks === null ? (
        <p className="m-0 text-sm text-muted-foreground">Not available right now.</p>
      ) : (
        <ExtensionBlocks blocks={state.blocks} />
      )}
    </Panel>
  );
}

function InputField({
  field,
  value,
  onChange,
}: {
  field: ActionField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `action-${field.key}`;

  if (field.kind === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        <Label htmlFor={id}>{field.label}</Label>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{field.label}</Label>
        {!field.required && <span className="text-xs text-muted-foreground">Optional</span>}
      </div>
      {field.kind === "enum" ? (
        <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
          value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
          onChange={(e) =>
            onChange(
              field.kind === "number"
                ? e.target.value === ""
                  ? undefined
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </div>
  );
}

function ActionDialog({
  surface,
  onClose,
  run,
  onDone,
}: {
  surface: ExtensionSurface;
  onClose: () => void;
  run: Props["runAction"];
  onDone?: Props["onActionDone"];
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await run(surface.bindingId, values);

      setOutcome(result);
      onDone?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{surface.label}</DialogTitle>
          {surface.inputFields.length === 0 && !outcome && (
            <DialogDescription>Runs the product's extension for this record.</DialogDescription>
          )}
        </DialogHeader>
        {outcome ? (
          <div className="grid gap-4">
            {outcome.message && <p className="m-0 text-sm">{outcome.message}</p>}
            {outcome.applied && outcome.applied.length > 0 && (
              <p className="m-0 text-sm text-muted-foreground">
                Updated{" "}
                {outcome.applied.length === 1 ? "1 field" : `${outcome.applied.length} fields`}.
              </p>
            )}
            {outcome.blocks.length > 0 && <ExtensionBlocks blocks={outcome.blocks} />}
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            {surface.inputFields.map((field) => (
              <InputField
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))}
            {error && (
              <Notice tone="error" title="Couldn't run this action">
                {error}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {surface.label}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The record_panel and action extensions a product puts on a record page. */
export function ExtensionSurfaces({ surfaces, loadPanel, runAction, canAct, onActionDone }: Props) {
  const [active, setActive] = useState<ExtensionSurface | null>(null);
  const panels = surfaces.filter((s) => s.point === "record_panel");
  const actions = surfaces.filter((s) => s.point === "action");

  if (surfaces.length === 0) return null;

  return (
    <>
      {panels.map((surface) => (
        <ExtensionPanel key={surface.bindingId} surface={surface} load={loadPanel} />
      ))}
      {canAct && actions.length > 0 && (
        <Panel title="Actions">
          <div className="flex flex-wrap gap-2">
            {actions.map((surface) => (
              <Button
                key={surface.bindingId}
                variant="outline"
                size="sm"
                onClick={() => setActive(surface)}
              >
                {surface.label}
              </Button>
            ))}
          </div>
        </Panel>
      )}
      {active && (
        <ActionDialog
          surface={active}
          onClose={() => setActive(null)}
          run={runAction}
          {...(onActionDone && { onDone: onActionDone })}
        />
      )}
    </>
  );
}

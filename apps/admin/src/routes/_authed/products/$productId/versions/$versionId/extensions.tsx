import {
  ACTION_FIELD_KINDS,
  type ActionField,
  EXTENSION_POINTS,
  type ExtensionPoint,
  POINT_SPECS,
} from "@pas/extension-points";
import { isField, schemaIndex } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { type ExtensionBinding, useVersionEditor } from "@/components/catalog/version-editor";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/extensions")(
  {
    validateSearch: (search: Record<string, unknown>): { binding?: string } =>
      typeof search.binding === "string" ? { binding: search.binding } : {},
    component: ExtensionsTab,
  },
);

const BINDABLE = EXTENSION_POINTS.filter((p) => POINT_SPECS[p].productBound && p !== "rate");
const RECORDS = { submission: "Submission page", policy: "Policy page" } as const;

const KIND_LABELS: Record<ActionField["kind"], string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes or no",
  enum: "Choice",
};

const newBinding = (): ExtensionBinding => ({
  id: crypto.randomUUID(),
  point: "validate",
  extensionVersionId: "",
});

function ExtensionsTab() {
  const { version, contents, set, readOnly } = useVersionEditor();
  const search = Route.useSearch();
  const trpc = useTRPC();
  const choices = useQuery(trpc.extensions.versionChoices.queryOptions({}));
  const [editing, setEditing] = useState<ExtensionBinding | null>(null);
  const bindings = contents.extensions;
  const locked = readOnly || version.status !== "draft";

  const versionName = (id: string) => {
    const choice = choices.data?.find((c) => c.versionId === id);

    return choice ? `${choice.name} · v${choice.version}` : "Unknown version";
  };

  const save = (binding: ExtensionBinding) => {
    const exists = bindings.some((b) => b.id === binding.id);

    set(
      "extensions",
      exists ? bindings.map((b) => (b.id === binding.id ? binding : b)) : [...bindings, binding],
      true,
    );

    setEditing(null);
  };

  return (
    <PageBody className="max-w-6xl">
      <Panel
        flush
        title="Extensions"
        description="Tenant code this version runs at named points. Each binding pins a published extension version."
        action={
          !locked && (
            <Button size="sm" onClick={() => setEditing(newBinding())}>
              <Plus /> Add extension
            </Button>
          )
        }
      >
        {bindings.length === 0 ? (
          <EmptyState
            title="No extensions"
            description="Configuration covers most products; bind an extension for the rest."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Point</TableHead>
                <TableHead>Extension</TableHead>
                <TableHead>Attaches to</TableHead>
                <TableHead>If it fails</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((binding) => {
                const spec = POINT_SPECS[binding.point];

                const policy = spec.failClosed
                  ? "block"
                  : (binding.onFailure ?? spec.defaultFailure);

                return (
                  <TableRow
                    key={binding.id}
                    className={cn(
                      "h-13 cursor-pointer hover:bg-muted/40",
                      search.binding === binding.id && "bg-primary/5",
                    )}
                    onClick={() => setEditing(binding)}
                  >
                    <TableCell className="font-medium">{spec.label}</TableCell>
                    <TableCell>
                      {binding.extensionVersionId ? (
                        versionName(binding.extensionVersionId)
                      ) : (
                        <span className="text-muted-foreground">Not chosen</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {binding.field ??
                        (binding.record
                          ? `${RECORDS[binding.record]} · ${binding.label ?? ""}`
                          : "–")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {policy === "block" ? "Stop" : "Carry on without it"}
                    </TableCell>
                    <TableCell>
                      {!locked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove"
                          onClick={(e) => {
                            e.stopPropagation();

                            set(
                              "extensions",
                              bindings.filter((b) => b.id !== binding.id),
                              true,
                            );
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
      {editing && (
        <BindingDialog
          binding={editing}
          readOnly={locked}
          fieldPaths={fieldPathsOf(contents.riskSchema)}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </PageBody>
  );
}

function fieldPathsOf(schema: Parameters<typeof schemaIndex>[0]) {
  return [...schemaIndex(schema).entries()]
    .filter(([, node]) => isField(node))
    .map(([path, node]) => ({ path, label: node.label }));
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-xs text-muted-foreground">Optional</span>}
      </div>
      {children}
    </div>
  );
}

function BindingDialog({
  binding,
  readOnly,
  fieldPaths,
  onCancel,
  onSave,
}: {
  binding: ExtensionBinding;
  readOnly: boolean;
  fieldPaths: { path: string; label: string }[];
  onCancel: () => void;
  onSave: (binding: ExtensionBinding) => void;
}) {
  const trpc = useTRPC();
  const [draft, setDraft] = useState(binding);
  const spec = POINT_SPECS[draft.point];
  const choices = useQuery(trpc.extensions.versionChoices.queryOptions({ point: draft.point }));
  const update = (changes: Partial<ExtensionBinding>) => setDraft((d) => ({ ...d, ...changes }));

  const setPoint = (point: ExtensionPoint) => {
    const { field: _f, record: _r, label: _l, inputFields: _i, onFailure: _o, ...rest } = draft;

    setDraft({ ...rest, point, extensionVersionId: "" });
  };

  const valid = useMemo(
    () =>
      !!draft.extensionVersionId &&
      (spec.target !== "field" || !!draft.field) &&
      (spec.target !== "record" || (!!draft.record && !!draft.label?.trim())),
    [draft, spec.target],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{binding.extensionVersionId ? spec.label : "Add extension"}</DialogTitle>
          <DialogDescription>
            Runs in the sandbox with its own limits; publishing this version pins the extension
            version.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();

            if (valid) onSave(draft);
          }}
        >
          <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="binding-point" label="Point">
                <Select value={draft.point} onValueChange={(p) => setPoint(p as ExtensionPoint)}>
                  <SelectTrigger id="binding-point">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BINDABLE.map((point) => (
                      <SelectItem key={point} value={point}>
                        {POINT_SPECS[point].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="binding-version" label="Extension version">
                <Select
                  value={draft.extensionVersionId}
                  onValueChange={(extensionVersionId) => update({ extensionVersionId })}
                >
                  <SelectTrigger id="binding-version">
                    <SelectValue placeholder="Choose a version" />
                  </SelectTrigger>
                  <SelectContent>
                    {(choices.data ?? []).map((c) => (
                      <SelectItem key={c.versionId} value={c.versionId}>
                        {c.name} · v{c.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {choices.data?.length === 0 && (
              <p className="m-0 text-sm text-muted-foreground">
                No published extension implements {spec.label.toLowerCase()} yet.{" "}
                <Link to="/extensions" className="font-medium text-primary hover:underline">
                  Open extensions
                </Link>
              </p>
            )}

            {spec.target === "field" && (
              <Field
                id="binding-field"
                label={draft.point === "field_prefill" ? "When this field changes" : "Field"}
              >
                <Select value={draft.field ?? ""} onValueChange={(field) => update({ field })}>
                  <SelectTrigger id="binding-field">
                    <SelectValue placeholder="Choose a field" />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldPaths.map((f) => (
                      <SelectItem key={f.path} value={f.path} description={f.path}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {spec.target === "record" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="binding-record" label="Shown on">
                  <Select
                    value={draft.record ?? ""}
                    onValueChange={(record) => update({ record: record as keyof typeof RECORDS })}
                  >
                    <SelectTrigger id="binding-record">
                      <SelectValue placeholder="Choose a page" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RECORDS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id="binding-label"
                  label={draft.point === "action" ? "Button label" : "Panel title"}
                >
                  <Input
                    id="binding-label"
                    value={draft.label ?? ""}
                    maxLength={80}
                    onChange={(e) => update({ label: e.target.value })}
                  />
                </Field>
              </div>
            )}

            {draft.point === "action" && (
              <InputFieldsEditor
                fields={draft.inputFields ?? []}
                onChange={(inputFields) => update({ inputFields })}
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="binding-timeout" label="Time limit (ms)" optional>
                <Input
                  id="binding-timeout"
                  type="number"
                  min={100}
                  max={spec.maxTimeoutMs}
                  placeholder={String(spec.defaultTimeoutMs)}
                  value={draft.timeoutMs ?? ""}
                  className="tabular-nums"
                  onChange={(e) => {
                    const { timeoutMs: _t, ...rest } = draft;

                    setDraft(
                      e.target.value ? { ...rest, timeoutMs: Number(e.target.value) } : rest,
                    );
                  }}
                />
              </Field>
              <Field id="binding-failure" label="If it fails">
                <Select
                  value={spec.failClosed ? "block" : (draft.onFailure ?? spec.defaultFailure)}
                  onValueChange={(onFailure) =>
                    update({ onFailure: onFailure as "block" | "skip" })
                  }
                  disabled={spec.failClosed}
                >
                  <SelectTrigger id="binding-failure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="block">Stop with an error</SelectItem>
                    <SelectItem value="skip">Carry on without it</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={!valid}>
                {binding.extensionVersionId ? "Save extension" : "Add extension"}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const optionsText = (field: ActionField) =>
  (field.options ?? [])
    .map((o) => (o.value === o.label ? o.value : `${o.value}=${o.label}`))
    .join(", ");

const parseOptions = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [value, label] = part.split("=").map((p) => p.trim());

      return { value: value!, label: label || value! };
    });

function InputFieldsEditor({
  fields,
  onChange,
}: {
  fields: ActionField[];
  onChange: (fields: ActionField[]) => void;
}) {
  const replace = (i: number, next: ActionField) =>
    onChange(fields.map((f, j) => (j === i ? next : f)));

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">What the user fills in</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={fields.length >= 20}
          onClick={() =>
            onChange([...fields, { key: `field${fields.length + 1}`, label: "", kind: "text" }])
          }
        >
          <Plus /> Add input
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="m-0 text-sm text-muted-foreground">
          The action runs without asking anything.
        </p>
      )}
      {fields.map((field, i) => (
        <div key={i} className="grid gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="grid grid-cols-[1fr_1fr_8rem_auto] items-center gap-2">
            <Input
              aria-label="Key"
              value={field.key}
              className="font-mono text-xs"
              onChange={(e) => replace(i, { ...field, key: e.target.value })}
            />
            <Input
              aria-label="Label"
              placeholder="Label"
              value={field.label}
              onChange={(e) => replace(i, { ...field, label: e.target.value })}
            />
            <Select
              value={field.kind}
              onValueChange={(kind) => replace(i, { ...field, kind: kind as ActionField["kind"] })}
            >
              <SelectTrigger aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_FIELD_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Remove input"
              onClick={() => onChange(fields.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!field.required}
                onCheckedChange={(v) => replace(i, { ...field, required: v === true })}
              />
              Required
            </label>
            {field.kind === "enum" && (
              <Input
                aria-label="Options"
                placeholder="Options: low, medium=Medium risk, high"
                defaultValue={optionsText(field)}
                className="min-w-64 flex-1"
                onBlur={(e) => replace(i, { ...field, options: parseOptions(e.target.value) })}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

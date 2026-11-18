import type { FormDefinition } from "@pas/forms-core";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
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
import { createFileRoute } from "@tanstack/react-router";
import { FileText, MoreHorizontal, Plus } from "lucide-react";
import { useId, useState } from "react";
import { FormBuilder } from "@/components/builders/form-builder";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import {
  CHANNELS,
  channelLabel,
  formKey,
  formTitle,
  STAGES,
  stageLabel,
} from "@/components/catalog/forms";
import { useVersionEditor, type VersionForm } from "@/components/catalog/version-editor";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/questions")({
  validateSearch: (search: Record<string, unknown>): { form?: string } =>
    typeof search.form === "string" ? { form: search.form } : {},
  component: QuestionsTab,
});

const countItems = (form: FormDefinition) =>
  form.steps.reduce(
    (sum, step) => sum + step.sections.reduce((n, section) => n + section.items.length, 0),
    0,
  );

function QuestionsTab() {
  const { contents, readOnly, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const forms = contents.forms;

  const selectedKey = forms.some((f) => formKey(f) === search.form)
    ? search.form
    : forms[0] && formKey(forms[0]);

  const selected = forms.find((f) => formKey(f) === selectedKey);
  const full = forms.length >= CHANNELS.length * STAGES.length;

  const select = (key: string) => navigate({ search: { form: key }, replace: true });

  const update = (key: string, form: FormDefinition) =>
    set(
      "forms",
      forms.map((f) => (formKey(f) === key ? { ...f, form } : f)),
    );

  const addAction = !readOnly && !full && (
    <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
      <Plus /> Add question set
    </Button>
  );

  return (
    <PageBody>
      <Panel
        title="Questions"
        description="What each channel answers at each stage."
        action={forms.length > 0 && addAction}
        flush
      >
        {forms.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No questions yet"
            description="Add a question set for agents to start quoting this product."
            action={addAction}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question set</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Steps</TableHead>
                <TableHead className="text-right">Fields</TableHead>
                {!readOnly && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((entry) => {
                const key = formKey(entry);

                return (
                  <TableRow
                    key={key}
                    aria-selected={key === selectedKey}
                    className={cn(
                      "cursor-pointer",
                      key === selectedKey ? "bg-primary/5" : "hover:bg-muted/40",
                    )}
                    onClick={() => select(key)}
                  >
                    <TableCell className="font-medium">{formTitle(entry)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {channelLabel(entry.channel)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {stageLabel(entry.stage)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.form.steps.length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {countItems(entry.form)}
                    </TableCell>
                    {!readOnly && (
                      <TableCell
                        className="text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              aria-label="Question set actions"
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setRemoving(key)}>
                              Remove question set
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selected && (
        <FormBuilder
          key={formKey(selected)}
          schema={contents.riskSchema}
          value={selected.form}
          onChange={(next) => update(formKey(selected), next)}
          readOnly={readOnly}
        />
      )}

      <AddFormDialog
        open={adding}
        onOpenChange={setAdding}
        forms={forms}
        onAdd={(entry) => {
          set("forms", [...forms, entry], true);
          select(formKey(entry));
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? formTitle(forms.find((f) => formKey(f) === removing)!) : "question set"}`}
        description="Its steps and sections are removed from this draft."
        confirmLabel="Remove question set"
        onConfirm={() => {
          set(
            "forms",
            forms.filter((f) => formKey(f) !== removing),
            true,
          );
        }}
      />
    </PageBody>
  );
}

const BLANK = "blank";

function AddFormDialog({
  open,
  onOpenChange,
  forms,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forms: readonly VersionForm[];
  onAdd: (entry: VersionForm) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <AddFormFields
            forms={forms}
            onAdd={(entry) => {
              onAdd(entry);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddFormFields({
  forms,
  onAdd,
}: {
  forms: readonly VersionForm[];
  onAdd: (entry: VersionForm) => void;
}) {
  const id = useId();
  const taken = new Set(forms.map(formKey));

  const firstFree = CHANNELS.flatMap((c) =>
    STAGES.map((s) => ({ channel: c.value, stage: s.value })),
  ).find((combo) => !taken.has(formKey(combo)))!;

  const [channel, setChannel] = useState<VersionForm["channel"]>(firstFree.channel);
  const [stage, setStage] = useState<VersionForm["stage"]>(firstFree.stage);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState(forms[0] ? formKey(forms[0]) : BLANK);
  const key = formKey({ channel, stage });
  const clash = taken.has(key);
  const suggested = `${channelLabel(channel)} ${stageLabel(stage).toLowerCase()}`;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (clash) return;

    const base = forms.find((f) => formKey(f) === source)?.form;
    const formTitleValue = title.trim() || suggested;

    onAdd({
      channel,
      stage,
      form: {
        key: `${channel}-${stage}`,
        title: formTitleValue,
        steps: base ? structuredClone(base.steps) : [],
      },
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add question set</DialogTitle>
        <DialogDescription>Each channel can have one question set per stage.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-channel`}>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as VersionForm["channel"])}>
              <SelectTrigger id={`${id}-channel`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-stage`}>Stage</Label>
            <Select value={stage} onValueChange={(v) => setStage(v as VersionForm["stage"])}>
              <SelectTrigger id={`${id}-stage`} aria-invalid={clash}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem
                    key={s.value}
                    value={s.value}
                    disabled={taken.has(formKey({ channel, stage: s.value }))}
                  >
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {clash && (
          <p className="-mt-2 mb-0 text-xs text-destructive">
            There's already a {suggested.toLowerCase()} question set.
          </p>
        )}
        <div className="grid gap-2">
          <Label htmlFor={`${id}-title`}>Title</Label>
          <Input
            id={`${id}-title`}
            value={title}
            placeholder={suggested}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        {forms.length > 0 && (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-source`}>Start from</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id={`${id}-source`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {forms.map((f) => (
                  <SelectItem key={formKey(f)} value={formKey(f)}>
                    Copy of {formTitle(f)}
                  </SelectItem>
                ))}
                <SelectItem value={BLANK}>Blank question set</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter className="pt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={clash}>
            Add question set
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

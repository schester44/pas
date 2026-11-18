import {
  checkReferences,
  type FormDefinition,
  type FormItem,
  type FormSection,
  type FormStep,
  type ReferenceIssue,
  type RiskSchema,
} from "@pas/forms-core";
import { type FormData, IntakeForm, useExpressionsReady } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { Tree, type TreeRow } from "@pas/ui/components/tree";
import { cn } from "@pas/ui/lib/utils";
import { CircleCheck, Eye, Footprints, LayoutList, Plus, Rows3, Type } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { ConfirmDelete } from "./confirm-delete";
import { FormInspector } from "./form-inspector";
import {
  bindableFields,
  duplicateSel,
  type FormSel,
  fieldFor,
  insertSel,
  levelOf,
  locate,
  moveSel,
  parseSelId,
  removeSel,
  selId,
  uniqueId,
} from "./form-tree";
import { Code } from "./inspector";
import { KIND_META } from "./kinds";

export interface FormBuilderProps {
  schema: RiskSchema;
  value: FormDefinition;
  onChange: (next: FormDefinition) => void;
  readOnly?: boolean;
}

type View = "edit" | "preview" | "checks";

function sampleFor(schema: RiskSchema): FormData {
  return Object.fromEntries(
    schema.fields.flatMap((node) =>
      node.kind === "repeatable" && (node.minItems ?? 0) > 0
        ? [[node.key, Array.from({ length: node.minItems! }, () => ({}))]]
        : [],
    ),
  );
}

export function FormBuilder({ schema, value: form, onChange, readOnly }: FormBuilderProps) {
  const ready = useExpressionsReady();
  const [sel, setSel] = useState<FormSel>(form.steps.length ? { step: 0 } : {});
  const [view, setView] = useState<View>("edit");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<FormSel>();
  const [sample, setSample] = useState<FormData>(() => sampleFor(schema));
  const [submitted, setSubmitted] = useState(false);
  const issues = useMemo(() => (ready ? checkReferences(schema, form) : []), [ready, schema, form]);

  const flagged = useMemo(
    () => new Set(issues.map((issue) => selId(locate(form, issue)))),
    [issues, form],
  );

  const select = (next: FormSel) => {
    setSel(next);
    setView("edit");
  };

  const expand = (...ids: string[]) =>
    setCollapsed((prev) => {
      const next = new Set(prev);

      for (const id of ids) next.delete(id);

      return next;
    });

  const step = sel.step !== undefined ? form.steps[sel.step] : form.steps.at(-1);
  const stepIndex = sel.step ?? form.steps.length - 1;

  const section =
    step && (sel.section !== undefined ? step.sections[sel.section] : step.sections.at(-1));

  const sectionIndex = sel.section ?? (step ? step.sections.length - 1 : -1);

  const addStep = () => {
    const at = sel.step !== undefined ? sel.step + 1 : form.steps.length;

    const created: FormStep = {
      id: uniqueId(
        form.steps.map((candidate) => candidate.id),
        "step",
      ),
      title: "New step",
      sections: [],
    };

    onChange(insertSel(form, { step: at }, created));
    select({ step: at });
  };

  const addSection = () => {
    if (!step) return;

    const at = sel.section !== undefined ? sel.section + 1 : step.sections.length;

    const created: FormSection = {
      id: uniqueId(
        step.sections.map((candidate) => candidate.id),
        "section",
      ),
      title: "New section",
      items: [],
    };

    onChange(insertSel(form, { step: stepIndex, section: at }, created));
    expand(String(stepIndex));
    select({ step: stepIndex, section: at });
  };

  const addItem = () => {
    if (!section) return;

    const bound = new Set(section.items.map((item) => item.path));
    const next = bindableFields(schema, section.repeat).find((field) => !bound.has(field.path));
    const at = sel.item !== undefined ? sel.item + 1 : section.items.length;
    const created: FormItem = { path: next?.path ?? "" };
    onChange(insertSel(form, { step: stepIndex, section: sectionIndex, item: at }, created));
    expand(String(stepIndex), `${stepIndex}.${sectionIndex}`);
    select({ step: stepIndex, section: sectionIndex, item: at });
  };

  const move = (target: FormSel, delta: -1 | 1) => {
    const moved = moveSel(form, target, delta);

    if (!moved) return;

    onChange(moved.form);
    setSel(moved.sel);
  };

  const remove = (target: FormSel) => {
    const result = removeSel(form, target);
    onChange(result.form);
    setSel(result.sel);
  };

  const requestDelete = (target: FormSel) => {
    const level = levelOf(target);

    const hasContent =
      (level === "step" && form.steps[target.step!]!.sections.length > 0) ||
      (level === "section" &&
        form.steps[target.step!]!.sections[target.section!]!.items.length > 0);

    if (hasContent) setDeleting(target);
    else remove(target);
  };

  const rows = useMemo(
    () => outlineRows(schema, form, collapsed, flagged),
    [schema, form, collapsed, flagged],
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);

      if (!next.delete(id)) next.add(id);

      return next;
    });

  const deletingLabel = deleting
    ? levelOf(deleting) === "step"
      ? form.steps[deleting.step!]?.title
      : form.steps[deleting.step!]?.sections[deleting.section!]?.title
    : undefined;

  return (
    <Card className="grid min-h-[36rem] overflow-hidden lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-b bg-muted/30 lg:border-r lg:border-b-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b pr-3 pl-1.5">
          <button
            type="button"
            onClick={() => select({})}
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-md px-2.5 text-sm font-medium outline-none hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              levelOf(sel) === "form" && view === "edit" && "bg-primary/[0.07]",
            )}
          >
            <span className="truncate">{form.title || "Untitled question set"}</span>
          </button>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={addStep}>
                  <Footprints /> Step
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!step} onSelect={addSection}>
                  <LayoutList /> Section
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!section} onSelect={addItem}>
                  <Type /> Field
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {rows.length > 0 ? (
          <Tree
            label="Form outline"
            rows={rows}
            selectedId={levelOf(sel) === "form" ? undefined : selId(sel)}
            onSelect={(id) => select(parseSelId(id))}
            onToggle={toggle}
            onMove={readOnly ? undefined : (id, delta) => move(parseSelId(id), delta)}
            className="max-h-[44rem] overflow-y-auto"
          />
        ) : (
          <p className="m-0 px-4 py-6 text-sm text-muted-foreground">No steps yet.</p>
        )}
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-6">
          <SegmentedControl
            label="View"
            value={view}
            onValueChange={setView}
            options={[
              { value: "edit", label: readOnly ? "Details" : "Edit" },
              { value: "preview", label: "Preview" },
              {
                value: "checks",
                label: (
                  <>
                    Checks
                    {issues.length > 0 && (
                      <span className="rounded-full bg-red-50 px-1.5 text-xs leading-4 font-medium text-red-700 tabular-nums ring-1 ring-red-200">
                        {issues.length}
                      </span>
                    )}
                  </>
                ),
              },
            ]}
          />
          {view === "preview" && (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 text-muted-foreground"
              onClick={() => {
                setSample(sampleFor(schema));
                setSubmitted(false);
              }}
            >
              Clear answers
            </Button>
          )}
        </div>

        {view === "edit" &&
          (levelOf(sel) === "form" || selectionExists(form, sel) ? (
            <FormInspector
              key={selId(sel)}
              schema={schema}
              form={form}
              sel={sel}
              issues={issues}
              readOnly={readOnly}
              onChange={onChange}
              onMove={(delta) => move(sel, delta)}
              onDuplicate={() => {
                const result = duplicateSel(form, sel);
                onChange(result.form);
                setSel(result.sel);
              }}
              onDelete={() => requestDelete(sel)}
            />
          ) : (
            <EmptyState title="Select a step, section or field" className="py-24" />
          ))}

        {view === "preview" && (
          <div className="flex-1 bg-canvas px-6 py-8">
            <div className="mx-auto grid max-w-3xl gap-6">
              {submitted && (
                <Notice title="Every answer is valid">
                  The submission would be accepted as entered.
                </Notice>
              )}
              {form.steps.some((candidate) => candidate.sections.length > 0) ? (
                <IntakeForm
                  schema={schema}
                  form={form}
                  value={sample}
                  onChange={(next) => {
                    setSample(next);
                    setSubmitted(false);
                  }}
                  onSubmit={() => setSubmitted(true)}
                />
              ) : (
                <EmptyState
                  icon={<Eye />}
                  title="Nothing to preview yet"
                  description="Add a section with fields."
                />
              )}
            </div>
          </div>
        )}

        {view === "checks" && (
          <ChecksPanel schema={schema} form={form} issues={issues} onSelect={select} />
        )}
      </div>

      <ConfirmDelete
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={`Delete ${deletingLabel || (deleting && levelOf(deleting)) || ""}?`}
        description={
          deleting && levelOf(deleting) === "step"
            ? "This deletes the step with all its sections and fields. The risk schema isn't changed."
            : "This deletes the section and its fields. The risk schema isn't changed."
        }
        onConfirm={() => deleting && remove(deleting)}
      />
    </Card>
  );
}

function selectionExists(form: FormDefinition, sel: FormSel) {
  const step = form.steps[sel.step ?? -1];

  if (!step) return false;

  if (sel.section === undefined) return true;

  const section = step.sections[sel.section];

  if (!section) return false;

  return sel.item === undefined || section.items[sel.item] !== undefined;
}

function outlineRows(
  schema: RiskSchema,
  form: FormDefinition,
  collapsed: ReadonlySet<string>,
  flagged: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];

  form.steps.forEach((step, s) => {
    const stepId = String(s);
    const stepOpen = !collapsed.has(stepId);

    rows.push({
      id: stepId,
      depth: 0,
      label: step.title || "Untitled step",
      expanded: step.sections.length ? stepOpen : undefined,
      content: (
        <OutlineRow
          lead={
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border">
              {s + 1}
            </span>
          }
          label={step.title || "Untitled step"}
          strong
          flagged={flagged.has(stepId)}
          conditional={!!step.visibleWhen}
        />
      ),
    });

    if (!stepOpen) return;

    step.sections.forEach((section, c) => {
      const sectionId = `${s}.${c}`;
      const sectionOpen = !collapsed.has(sectionId);

      const repeatLabel = section.repeat
        ? schema.fields.find((node) => node.key === section.repeat)?.label
        : undefined;

      const Icon = section.repeat ? Rows3 : LayoutList;

      rows.push({
        id: sectionId,
        depth: 1,
        label: section.title || repeatLabel || section.id,
        expanded: section.items.length ? sectionOpen : undefined,
        content: (
          <OutlineRow
            lead={
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  section.repeat ? "text-primary" : "text-muted-foreground",
                )}
              />
            }
            label={section.title || repeatLabel || section.id}
            flagged={flagged.has(sectionId)}
            conditional={!!section.visibleWhen}
            meta={section.repeat ? "Repeats" : undefined}
          />
        ),
      });

      if (!sectionOpen) return;

      section.items.forEach((item, i) => {
        const itemId = `${sectionId}.${i}`;
        const field = fieldFor(schema, item.path, section.repeat);
        const FieldIcon = field ? KIND_META[field.kind].icon : Type;

        rows.push({
          id: itemId,
          depth: 2,
          label: item.label || field?.label || item.path || "Unbound field",
          content: (
            <OutlineRow
              lead={<FieldIcon className="size-4 shrink-0 text-muted-foreground" />}
              label={item.label || field?.label || item.path || "Unbound field"}
              flagged={flagged.has(itemId)}
              conditional={!!item.visibleWhen}
              muted={!field}
            />
          ),
        });
      });
    });
  });

  return rows;
}

function OutlineRow({
  lead,
  label,
  strong,
  flagged,
  conditional,
  meta,
  muted,
}: {
  lead: React.ReactNode;
  label: string;
  strong?: boolean;
  flagged: boolean;
  conditional: boolean;
  meta?: string;
  muted?: boolean;
}) {
  return (
    <>
      {lead}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          strong && "font-medium",
          muted && "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {conditional && (
        <span title="Shown conditionally" className="shrink-0 text-muted-foreground">
          <Eye aria-label="Shown conditionally" className="size-3.5" />
        </span>
      )}
      {flagged ? (
        <span aria-label="Has problems" className="size-1.5 shrink-0 rounded-full bg-red-500" />
      ) : (
        meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
      )}
    </>
  );
}

const PROPERTY_LABELS: Record<string, string> = {
  path: "Field",
  widget: "Widget",
  visibleWhen: "Visible when",
  requiredWhen: "Required when",
  repeat: "Repeats for",
  id: "ID",
};

function propertyLabel(property: string) {
  const rule = /^validations\[(\d+)\]$/.exec(property);

  return rule ? `Rule ${Number(rule[1]) + 1}` : (PROPERTY_LABELS[property] ?? property);
}

function ChecksPanel({
  schema,
  form,
  issues,
  onSelect,
}: {
  schema: RiskSchema;
  form: FormDefinition;
  issues: ReferenceIssue[];
  onSelect: (sel: FormSel) => void;
}) {
  if (issues.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheck />}
        title="No problems found"
        description="Every binding and expression resolves against the risk schema."
        className="py-24"
      />
    );
  }

  return (
    <ul className="m-0 grid list-none divide-y p-0">
      {issues.map((issue, index) => {
        const target = locate(form, issue);
        const step = form.steps[target.step ?? -1];
        const section = step?.sections[target.section ?? -1];

        const repeatLabel = section?.repeat
          ? schema.fields.find((node) => node.key === section.repeat)?.label
          : undefined;

        const where = [
          step?.title,
          section?.title || repeatLabel || section?.id,
          issue.item,
        ].filter(Boolean);

        return (
          <li key={index}>
            <button
              type="button"
              onClick={() => onSelect(target)}
              className="flex w-full items-start gap-3 px-6 py-3.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium">{issue.message}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {where.map((part, i) => (
                    <span key={i}>
                      {i > 0 && " › "}
                      {part === issue.item ? (
                        <Code className="text-xs text-muted-foreground">{part}</Code>
                      ) : (
                        part
                      )}
                    </span>
                  ))}
                  {" · "}
                  {propertyLabel(issue.property)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

import {
  type FormDefinition,
  type FormItem,
  type FormSection,
  type FormStep,
  type ReferenceIssue,
  type RiskSchema,
  WIDGET_KINDS,
  WIDGETS,
  type Widget,
} from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Textarea } from "@pas/ui/components/textarea";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileText,
  Footprints,
  LayoutList,
  Plus,
  Rows3,
  Trash,
  X,
} from "lucide-react";
import type * as React from "react";
import { useId } from "react";
import { ExpressionInput, ExpressionView } from "./expression-input";
import {
  type FormSel,
  fieldFor,
  issuesAt,
  rootRepeatables,
  siblingCount,
  updateItem,
  updateSection,
  updateStep,
} from "./form-tree";
import {
  Code,
  FlagProp,
  IconAction,
  InspectorBody,
  InspectorHeader,
  InspectorSection,
  Prop,
  PropRow,
} from "./inspector";
import { KIND_META, WIDGET_LABELS } from "./kinds";
import { PathPicker } from "./path-picker";

export interface FormInspectorProps {
  schema: RiskSchema;
  form: FormDefinition;
  sel: FormSel;
  issues: ReferenceIssue[];
  readOnly?: boolean;
  onChange: (form: FormDefinition) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const ID = /^[a-z][a-z0-9_-]*$/;

function idProblem(id: string, issues: ReferenceIssue[]) {
  if (!id) return "Enter an ID";

  if (!ID.test(id)) return "Start with a letter; use lowercase letters, digits, - and _";

  return issues.find((issue) => issue.property === "id")?.message;
}

const REQUIRED_KEYS = new Set(["id", "path"]);

function clean<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) => entry !== undefined && (entry !== "" || REQUIRED_KEYS.has(key)),
    ),
  ) as T;
}

const HINTS = {
  visible: "Shown only while this is true. Leave empty to always show.",
  required: "Required only while this is true.",
  validation: "The answer is valid while this is true; otherwise the message shows.",
};

export function FormInspector(props: FormInspectorProps) {
  const { sel } = props;

  if (sel.item !== undefined) return <ItemInspector {...props} />;

  if (sel.section !== undefined) return <SectionInspector {...props} />;

  if (sel.step !== undefined) return <StepInspector {...props} />;

  return <FormSettings {...props} />;
}

function Actions({ form, sel, readOnly, onMove, onDuplicate, onDelete }: FormInspectorProps) {
  if (readOnly) return null;

  const index = sel.item ?? sel.section ?? sel.step ?? 0;

  return (
    <>
      <IconAction
        label="Move up"
        icon={ArrowUp}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      />
      <IconAction
        label="Move down"
        icon={ArrowDown}
        disabled={index === siblingCount(form, sel) - 1}
        onClick={() => onMove(1)}
      />
      <IconAction label="Duplicate" icon={Copy} onClick={onDuplicate} />
      <IconAction
        label="Delete"
        icon={Trash}
        onClick={onDelete}
        className="hover:bg-red-50 hover:text-destructive"
      />
    </>
  );
}

function TextProp({
  label,
  value,
  onChange,
  readOnly,
  optional,
  placeholder,
  hint,
  error,
  mono,
  multiline,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly?: boolean;
  optional?: boolean;
  placeholder?: string;
  hint?: React.ReactNode;
  error?: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  const id = useId();
  const Control = multiline ? Textarea : Input;

  return (
    <Prop
      label={label}
      htmlFor={id}
      optional={optional}
      readOnly={readOnly}
      value={mono && value ? <Code>{value}</Code> : value}
      hint={hint}
      error={error}
    >
      <Control
        id={id}
        value={value ?? ""}
        placeholder={placeholder}
        aria-invalid={!!error}
        spellCheck={mono ? false : undefined}
        className={multiline ? "min-h-16" : mono ? "font-mono text-[0.8125rem]" : undefined}
        onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(event.target.value)
        }
      />
    </Prop>
  );
}

function ExpressionProp({
  label,
  value,
  onChange,
  readOnly,
  schema,
  repeat,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  readOnly?: boolean;
  schema: RiskSchema;
  repeat?: string;
  hint: string;
}) {
  const id = useId();

  return (
    <Prop
      label={label}
      htmlFor={id}
      optional
      readOnly={readOnly}
      value={value ? <ExpressionView value={value} /> : undefined}
    >
      <ExpressionInput
        id={id}
        value={value ?? ""}
        onChange={(next) => onChange(next || undefined)}
        schema={schema}
        repeat={repeat}
        hint={hint}
        placeholder={repeat ? "$item.yearBuilt < 1950" : "priorClaims > 0"}
      />
    </Prop>
  );
}

function FormSettings({ form, readOnly, onChange }: FormInspectorProps) {
  const items = form.steps.reduce(
    (sum, step) => sum + step.sections.reduce((count, section) => count + section.items.length, 0),
    0,
  );

  return (
    <div>
      <InspectorHeader
        icon={FileText}
        title={form.title || "Untitled question set"}
        subtitle={
          <span className="tabular-nums">
            {form.steps.length} {form.steps.length === 1 ? "step" : "steps"} · {items}{" "}
            {items === 1 ? "field" : "fields"}
          </span>
        }
      />
      <InspectorBody>
        <InspectorSection title="Question set" readOnly={readOnly}>
          <PropRow>
            <TextProp
              label="Title"
              value={form.title}
              readOnly={readOnly}
              error={form.title.trim() ? undefined : "Enter a title"}
              onChange={(title) => onChange({ ...form, title })}
            />
            <TextProp
              label="Key"
              value={form.key}
              mono
              readOnly={readOnly}
              error={form.key ? undefined : "Enter a key"}
              hint="How rules, APIs and channels refer to this question set."
              onChange={(key) => onChange({ ...form, key: key.trim() })}
            />
          </PropRow>
        </InspectorSection>
      </InspectorBody>
    </div>
  );
}

function StepInspector(props: FormInspectorProps) {
  const { form, sel, schema, issues, readOnly, onChange } = props;
  const step = form.steps[sel.step!]!;

  const set = (patch: Partial<FormStep>) =>
    onChange(updateStep(form, sel.step!, (current) => clean({ ...current, ...patch })));

  const fieldCount = step.sections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <div>
      <InspectorHeader
        icon={Footprints}
        title={step.title || "Untitled step"}
        subtitle={
          <span className="tabular-nums">
            Step {sel.step! + 1} of {form.steps.length} · {fieldCount}{" "}
            {fieldCount === 1 ? "field" : "fields"}
          </span>
        }
        actions={<Actions {...props} />}
      />
      <InspectorBody>
        <InspectorSection title="Step" readOnly={readOnly}>
          <PropRow>
            <TextProp
              label="Title"
              value={step.title}
              readOnly={readOnly}
              error={step.title.trim() ? undefined : "Enter a title"}
              onChange={(title) =>
                onChange(updateStep(form, sel.step!, (current) => ({ ...current, title })))
              }
            />
            <TextProp
              label="ID"
              value={step.id}
              mono
              readOnly={readOnly}
              error={idProblem(step.id, issuesAt(form, issues, sel))}
              onChange={(id) => set({ id: id.trim() })}
            />
          </PropRow>
          <TextProp
            label="Description"
            value={step.description}
            optional
            multiline
            readOnly={readOnly}
            onChange={(description) => set({ description })}
          />
        </InspectorSection>
        <InspectorSection title="Logic" readOnly={readOnly}>
          <ExpressionProp
            label="Visible when"
            value={step.visibleWhen}
            schema={schema}
            readOnly={readOnly}
            hint="The step is skipped while this is false."
            onChange={(visibleWhen) => set({ visibleWhen })}
          />
        </InspectorSection>
      </InspectorBody>
    </div>
  );
}

function SectionInspector(props: FormInspectorProps) {
  const { form, sel, schema, issues, readOnly, onChange } = props;
  const id = useId();
  const section = form.steps[sel.step!]!.sections[sel.section!]!;
  const here = issuesAt(form, issues, sel);
  const repeatables = rootRepeatables(schema);
  const repeatNode = repeatables.find((node) => node.path === section.repeat);

  const set = (patch: Partial<FormSection>) =>
    onChange(updateSection(form, sel, (current) => clean({ ...current, ...patch })));

  return (
    <div>
      <InspectorHeader
        icon={section.repeat ? Rows3 : LayoutList}
        title={section.title || repeatNode?.label || "Untitled section"}
        subtitle={
          section.repeat ? (
            <>
              Repeats over <Code className="text-muted-foreground">{section.repeat}</Code>
            </>
          ) : (
            "Section"
          )
        }
        actions={<Actions {...props} />}
      />
      <InspectorBody>
        <InspectorSection title="Section" readOnly={readOnly}>
          <PropRow>
            <TextProp
              label="Title"
              value={section.title}
              optional
              placeholder={repeatNode?.label}
              readOnly={readOnly}
              onChange={(title) => set({ title })}
            />
            <TextProp
              label="ID"
              value={section.id}
              mono
              readOnly={readOnly}
              error={idProblem(section.id, here)}
              onChange={(value) => set({ id: value.trim() })}
            />
          </PropRow>
          <TextProp
            label="Description"
            value={section.description}
            optional
            multiline
            readOnly={readOnly}
            onChange={(description) => set({ description })}
          />
        </InspectorSection>
        <InspectorSection title="Repeat" readOnly={readOnly}>
          <PropRow>
            <Prop
              label="Repeats for"
              htmlFor={`${id}-repeat`}
              readOnly={readOnly}
              value={section.repeat ? <Code>{section.repeat}</Code> : "Doesn't repeat"}
              error={here.find((issue) => issue.property === "repeat")?.message}
              hint="Fields bind relative to each entry."
            >
              <Select
                value={section.repeat ?? "none"}
                onValueChange={(next) => set({ repeat: next === "none" ? undefined : next })}
              >
                <SelectTrigger id={`${id}-repeat`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Doesn't repeat</SelectItem>
                  {section.repeat && !repeatNode && (
                    <SelectItem value={section.repeat}>{section.repeat}</SelectItem>
                  )}
                  {repeatables.map((node) => (
                    <SelectItem key={node.path} value={node.path} description={node.path}>
                      {node.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
            {(section.repeat || readOnly) && (
              <TextProp
                label="Entry label"
                value={section.itemLabel}
                optional
                placeholder={repeatNode?.label}
                hint="Names each entry, as in Location 1."
                readOnly={readOnly}
                onChange={(itemLabel) => set({ itemLabel })}
              />
            )}
          </PropRow>
        </InspectorSection>
        <InspectorSection title="Logic" readOnly={readOnly}>
          <ExpressionProp
            label="Visible when"
            value={section.visibleWhen}
            schema={schema}
            readOnly={readOnly}
            hint={HINTS.visible}
            onChange={(visibleWhen) => set({ visibleWhen })}
          />
        </InspectorSection>
      </InspectorBody>
    </div>
  );
}

const WIDTHS = { auto: "Automatic", full: "Full width", half: "Half width" } as const;

function ItemInspector(props: FormInspectorProps) {
  const { form, sel, schema, issues, readOnly, onChange } = props;
  const id = useId();
  const section = form.steps[sel.step!]!.sections[sel.section!]!;
  const item = section.items[sel.item!]!;
  const repeat = section.repeat;
  const field = fieldFor(schema, item.path, repeat);
  const here = issuesAt(form, issues, sel);
  const problem = (property: string) => here.find((issue) => issue.property === property)?.message;

  const widgets = field
    ? WIDGETS.filter((widget) => WIDGET_KINDS[widget].includes(field.kind))
    : [];

  const bound = new Set(section.items.map((entry) => entry.path));
  const Icon = field ? KIND_META[field.kind].icon : LayoutList;

  const set = (patch: Partial<FormItem>) =>
    onChange(updateItem(form, sel, (current) => clean({ ...current, ...patch })));

  const validations = item.validations ?? [];

  const setValidations = (next: FormItem["validations"]) =>
    set({ validations: next && next.length > 0 ? next : undefined });

  return (
    <div>
      <InspectorHeader
        icon={Icon}
        title={item.label || field?.label || item.path || "Unbound field"}
        subtitle={
          item.path ? (
            <Code className="text-muted-foreground">
              {repeat ? `${repeat}[].${item.path}` : item.path}
            </Code>
          ) : (
            "Not bound to the schema"
          )
        }
        actions={<Actions {...props} />}
      />
      <InspectorBody>
        <InspectorSection title="Binding" readOnly={readOnly}>
          <Prop
            label="Field"
            htmlFor={`${id}-path`}
            readOnly={readOnly}
            value={
              field ? (
                <span className="flex items-center gap-2">
                  {field.label} <Code className="text-muted-foreground">{item.path}</Code>
                </span>
              ) : (
                <Code>{item.path}</Code>
              )
            }
            error={problem("path")}
            hint={
              field &&
              `${KIND_META[field.kind].label}${field.description ? `. ${field.description}` : ""}`
            }
          >
            <PathPicker
              id={`${id}-path`}
              schema={schema}
              repeat={repeat}
              value={item.path}
              bound={bound}
              invalid={!!problem("path")}
              onChange={(path) => set({ path })}
            />
          </Prop>
        </InspectorSection>

        <InspectorSection title="Display" readOnly={readOnly}>
          <PropRow>
            <TextProp
              label="Label"
              value={item.label}
              optional
              placeholder={field?.label}
              readOnly={readOnly}
              onChange={(label) => set({ label })}
            />
            <TextProp
              label="Placeholder"
              value={item.placeholder}
              optional
              readOnly={readOnly}
              onChange={(placeholder) => set({ placeholder })}
            />
          </PropRow>
          <TextProp
            label="Help"
            value={item.help}
            optional
            multiline
            placeholder={field?.description}
            readOnly={readOnly}
            onChange={(help) => set({ help })}
          />
          <PropRow>
            {(widgets.length > 0 || item.widget) && (
              <Prop
                label="Widget"
                htmlFor={`${id}-widget`}
                readOnly={readOnly}
                value={item.widget ? WIDGET_LABELS[item.widget] : "Default"}
                error={problem("widget")}
              >
                <Select
                  value={item.widget ?? "default"}
                  onValueChange={(next) =>
                    set({ widget: next === "default" ? undefined : (next as Widget) })
                  }
                >
                  <SelectTrigger id={`${id}-widget`} aria-invalid={!!problem("widget")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    {[...new Set([...widgets, ...(item.widget ? [item.widget] : [])])].map(
                      (widget) => (
                        <SelectItem key={widget} value={widget}>
                          {WIDGET_LABELS[widget]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </Prop>
            )}
            <Prop
              label="Width"
              htmlFor={`${id}-width`}
              readOnly={readOnly}
              value={WIDTHS[item.width ?? "auto"]}
            >
              <Select
                value={item.width ?? "auto"}
                onValueChange={(next) =>
                  set({ width: next === "auto" ? undefined : (next as "full" | "half") })
                }
              >
                <SelectTrigger id={`${id}-width`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(WIDTHS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
          </PropRow>
        </InspectorSection>

        <InspectorSection title="Logic" readOnly={readOnly}>
          <FlagProp
            label="Always required"
            description="The answer can't be left empty while the field is shown."
            checked={item.required === true}
            readOnly={readOnly}
            onChange={(checked) => set({ required: checked || undefined })}
          />
          {!item.required && (
            <ExpressionProp
              label="Required when"
              value={item.requiredWhen}
              schema={schema}
              repeat={repeat}
              readOnly={readOnly}
              hint={HINTS.required}
              onChange={(requiredWhen) => set({ requiredWhen })}
            />
          )}
          <ExpressionProp
            label="Visible when"
            value={item.visibleWhen}
            schema={schema}
            repeat={repeat}
            readOnly={readOnly}
            hint={HINTS.visible}
            onChange={(visibleWhen) => set({ visibleWhen })}
          />
        </InspectorSection>

        <InspectorSection
          title="Validations"
          action={
            !readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-mr-2 text-muted-foreground"
                onClick={() => setValidations([...validations, { expression: "", message: "" }])}
              >
                <Plus /> Add rule
              </Button>
            )
          }
        >
          {validations.length === 0 && (
            <p className="m-0 text-sm text-muted-foreground">
              {readOnly
                ? "No rules."
                : "No rules yet. Add one to check the answer beyond its type."}
            </p>
          )}
          {validations.map((validation, index) => {
            const update = (patch: Partial<typeof validation>) =>
              setValidations(
                validations.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
              );

            return readOnly ? (
              <div key={index} className="grid gap-2 rounded-lg border p-4">
                <ExpressionView value={validation.expression} />
                <p className="m-0 text-sm text-muted-foreground">Otherwise: {validation.message}</p>
              </div>
            ) : (
              <div key={index} className="grid gap-4 rounded-lg border p-4">
                <div className="-my-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    Rule {index + 1}
                  </span>
                  <IconAction
                    label={`Remove rule ${index + 1}`}
                    icon={X}
                    className="-mr-2"
                    onClick={() => setValidations(validations.filter((_, i) => i !== index))}
                  />
                </div>
                <Prop label="Valid when" htmlFor={`${id}-rule-${index}`}>
                  <ExpressionInput
                    id={`${id}-rule-${index}`}
                    value={validation.expression}
                    onChange={(expression) => update({ expression })}
                    schema={schema}
                    repeat={repeat}
                    hint={HINTS.validation}
                    placeholder={repeat ? "$item.yearBuilt >= 1800" : "priorClaims >= 0"}
                  />
                </Prop>
                <TextProp
                  label="Message"
                  value={validation.message}
                  placeholder="Enter a year from 1800 on"
                  error={validation.message.trim() ? undefined : "Enter the message people see"}
                  onChange={(message) => update({ message })}
                />
              </div>
            );
          })}
        </InspectorSection>
      </InspectorBody>
    </div>
  );
}

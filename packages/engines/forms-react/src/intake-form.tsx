import {
  evaluateForm,
  type FileValue,
  type FormDefinition,
  type FormSection,
  type FormState,
  getAt,
  isField,
  joinPath,
  type RiskSchema,
  type SectionState,
  schemaIndex,
  setAt,
  validateSubmission,
  withMinimumEntries,
} from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { Plus } from "lucide-react";
import type * as React from "react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { type Copy, defaultCopy } from "./copy";
import { Field } from "./field";
import { StepIndicator } from "./step-indicator";
import { useExpressionsReady } from "./use-expressions-ready";

export type FormData = Record<string, unknown>;

export interface IntakeFormProps {
  schema: RiskSchema;
  form: FormDefinition;
  value: FormData;
  onChange: (value: FormData) => void;
  onSubmit?: (data: FormData) => void | Promise<void>;
  /** Every step at once in one column, without panels, steps or submit: for editing data inline. */
  compact?: boolean;
  busy?: boolean;
  error?: React.ReactNode;
  /** Authoritative errors from the server, keyed by path. Each clears once its field is edited. */
  serverErrors?: Record<string, string[]>;
  copy?: Partial<Copy>;
  uploadFile?: (file: File) => Promise<FileValue>;
}

export function IntakeForm(props: IntakeFormProps) {
  const ready = useExpressionsReady();

  if (!ready) return <FormSkeleton />;

  return <ReadyIntakeForm {...props} />;
}

function ReadyIntakeForm({
  schema,
  form,
  value,
  onChange,
  onSubmit,
  busy,
  error,
  serverErrors,
  copy: copyOverrides,
  uploadFile,
  compact,
}: IntakeFormProps) {
  const copy = useMemo(() => ({ ...defaultCopy, ...copyOverrides }), [copyOverrides]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [seenServerErrors, setSeenServerErrors] = useState(serverErrors);
  const [current, setCurrent] = useState(form.steps[0]?.id);
  const [attempted, setAttempted] = useState<ReadonlySet<string>>(new Set());
  const [focusRequest, setFocusRequest] = useState(0);
  const root = useRef<HTMLFormElement>(null);

  const seedMinimumEntries = useEffectEvent((forSchema: RiskSchema, forForm: FormDefinition) => {
    const seeded = withMinimumEntries(forSchema, forForm, value);

    if (seeded !== value) onChange(seeded);
  });

  useEffect(() => seedMinimumEntries(schema, form), [schema, form]);

  if (seenServerErrors !== serverErrors) {
    setSeenServerErrors(serverErrors);
    setDismissed(new Set());

    if (serverErrors && Object.keys(serverErrors).length > 0) {
      const fresh = withServerErrors(evaluateForm(schema, form, value), serverErrors, new Set());
      const shown = fresh.steps.filter((candidate) => candidate.visible);
      setAttempted(new Set(shown.map((candidate) => candidate.id)));
      const firstInvalid = shown.find((candidate) => !candidate.valid);

      if (firstInvalid) setCurrent(firstInvalid.id);

      setFocusRequest((count) => count + 1);
    }
  }

  const state = useMemo(
    () => withServerErrors(evaluateForm(schema, form, value), serverErrors, dismissed),
    [schema, form, value, serverErrors, dismissed],
  );

  const dismiss = (path: string) => {
    if (serverErrors?.[path] && !dismissed.has(path)) setDismissed(new Set(dismissed).add(path));
  };

  useEffect(() => {
    if (focusRequest === 0) return;

    root.current?.scrollIntoView({ block: "start", behavior: "smooth" });

    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
    );
  }, [focusRequest]);

  const visibleSteps = state.steps.filter((step) => step.visible);

  const position = Math.max(
    0,
    visibleSteps.findIndex((step) => step.id === current),
  );

  const stepState = visibleSteps[position];
  const step = form.steps.find((candidate) => candidate.id === stepState?.id);
  const isLast = position === visibleSteps.length - 1;

  const focusFirstError = () =>
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
    );

  const goTo = (id: string) => {
    setCurrent(id);
    root.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stepState) return;

    if (!stepState.valid) {
      setAttempted((prev) => new Set(prev).add(stepState.id));
      focusFirstError();

      return;
    }

    if (!isLast) {
      goTo(visibleSteps[position + 1]!.id);

      return;
    }

    const submission = validateSubmission(schema, form, value);

    if (!submission.ok) {
      setAttempted(new Set(visibleSteps.map((candidate) => candidate.id)));
      const invalid = visibleSteps.find((candidate) => !candidate.valid);

      if (invalid) goTo(invalid.id);

      focusFirstError();

      return;
    }

    await onSubmit?.(submission.data);
  };

  if (compact) {
    return (
      <div className="grid gap-6">
        {visibleSteps.flatMap((candidate) => {
          const definition = form.steps.find((s) => s.id === candidate.id);

          return (definition?.sections ?? []).map((section, index) => {
            const sectionState = candidate.sections[index]!;

            if (!sectionState.visible) return null;

            return (
              <Section
                key={section.id}
                compact
                schema={schema}
                section={section}
                state={sectionState}
                value={value}
                onChange={onChange}
                onEdit={dismiss}
                showErrors={false}
                copy={copy}
                uploadFile={uploadFile}
              />
            );
          });
        })}
      </div>
    );
  }

  if (!step || !stepState) return null;

  const showErrors = attempted.has(step.id);

  return (
    <form ref={root} noValidate onSubmit={submit} className="grid scroll-mt-20 gap-6">
      {visibleSteps.length > 1 && (
        <StepIndicator
          steps={visibleSteps.map((candidate) => ({
            id: candidate.id,
            title: form.steps.find((s) => s.id === candidate.id)?.title ?? candidate.id,
          }))}
          current={position}
          label={copy.step(position + 1, visibleSteps.length)}
          onSelect={(index) => index < position && goTo(visibleSteps[index]!.id)}
        />
      )}
      {step.description && <p className="m-0 text-sm text-muted-foreground">{step.description}</p>}
      {step.sections.map((section, index) => {
        const sectionState = stepState.sections[index]!;

        if (!sectionState.visible) return null;

        return (
          <Section
            key={section.id}
            schema={schema}
            section={section}
            state={sectionState}
            value={value}
            onChange={onChange}
            onEdit={dismiss}
            showErrors={showErrors}
            copy={copy}
            uploadFile={uploadFile}
          />
        );
      })}
      {error}
      <div className="flex items-center justify-end gap-2">
        {position > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => goTo(visibleSteps[position - 1]!.id)}
          >
            {copy.back}
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {isLast ? copy.submit : copy.next}
        </Button>
      </div>
    </form>
  );
}

interface SectionProps {
  schema: RiskSchema;
  section: FormSection;
  state: SectionState;
  value: FormData;
  onChange: (value: FormData) => void;
  onEdit: (path: string) => void;
  showErrors: boolean;
  copy: Copy;
  uploadFile?: (file: File) => Promise<FileValue>;
  compact?: boolean;
}

function CompactSection({
  title,
  description,
  action,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      {(title || action) && (
        <header className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            {title && <h3 className="m-0 text-sm leading-5 font-semibold">{title}</h3>}
            {description && <p className="m-0 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="-my-1 shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

function Section({
  schema,
  section,
  state,
  value,
  onChange,
  onEdit,
  showErrors,
  copy,
  uploadFile,
  compact,
}: SectionProps) {
  const index = schemaIndex(schema);
  const Container = compact ? CompactSection : Panel;

  const fields = (base: string | null, entry: SectionState["entries"][number]) => (
    <div className={compact ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
      {section.items.map((item, i) => {
        const itemState = entry.items[i]!;
        const canonical = base ? `${section.repeat}[].${item.path}` : item.path;
        const field = index.get(canonical);

        if (!itemState.visible || !isField(field)) return null;

        return (
          <Field
            key={item.path}
            field={field}
            item={item}
            state={itemState}
            value={getAt(value, itemState.path)}
            onChange={(next) => {
              onEdit(itemState.path);
              onChange(setAt(value, itemState.path, next));
            }}
            showErrors={showErrors}
            copy={copy}
            uploadFile={uploadFile}
            compact={compact}
          />
        );
      })}
    </div>
  );

  if (!section.repeat) {
    return (
      <Container title={section.title} description={section.description}>
        {fields(null, state.entries[0]!)}
      </Container>
    );
  }

  const repeat = section.repeat;
  const node = index.get(repeat);
  const plural = node?.label ?? section.title ?? repeat;
  const noun = section.itemLabel ?? plural;
  const rows = (getAt(value, repeat) as unknown[] | undefined) ?? [];
  const max = node?.kind === "repeatable" ? node.maxItems : undefined;
  const min = node?.kind === "repeatable" ? (node.minItems ?? 0) : 0;

  const add = () => {
    onEdit(repeat);
    onChange(setAt(value, repeat, [...rows, {}]));
  };

  const remove = (at: number) => {
    onEdit(repeat);

    onChange(
      setAt(
        value,
        repeat,
        rows.filter((_, i) => i !== at),
      ),
    );
  };

  const addButton = (max === undefined || rows.length < max) && (
    <Button type="button" variant="outline" size="sm" onClick={add}>
      <Plus /> {copy.add(noun)}
    </Button>
  );

  return (
    <Container title={section.title ?? plural} description={section.description} action={addButton}>
      <div className="grid gap-4">
        {state.entries.length === 0 && (
          <p className="m-0 py-2 text-sm text-muted-foreground">{copy.empty(plural)}</p>
        )}
        {state.entries.map((entry) => {
          const base = joinPath(repeat, `[${entry.index}]`);

          return (
            <section
              key={entry.index}
              className={
                compact ? "grid gap-3 rounded-lg border p-3" : "grid gap-4 rounded-lg border p-4"
              }
            >
              <header className="flex items-center justify-between gap-4">
                <h3 className="m-0 text-sm leading-5 font-medium">
                  {copy.entry(noun, entry.index! + 1)}
                </h3>
                {rows.length > min && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-my-1 -mr-2 text-muted-foreground"
                    onClick={() => remove(entry.index!)}
                  >
                    {copy.remove}
                  </Button>
                )}
              </header>
              {fields(base, entry)}
            </section>
          );
        })}
        {showErrors && state.errors.length > 0 && (
          <p className="m-0 text-sm text-destructive">{state.errors[0]}</p>
        )}
      </div>
    </Container>
  );
}

function withServerErrors(
  state: FormState,
  serverErrors: Record<string, string[]> | undefined,
  dismissed: ReadonlySet<string>,
): FormState {
  const active = Object.entries(serverErrors ?? {}).filter(
    ([path, messages]) => messages.length > 0 && !dismissed.has(path),
  );

  if (active.length === 0) return state;

  const pending = new Map(active);

  const merge = (path: string | undefined, errors: string[]) =>
    errors.length === 0 && path ? (pending.get(path) ?? errors) : errors;

  const items: FormState["items"] = {};

  const steps = state.steps.map((step) => {
    const sections = step.sections.map((section) => ({
      ...section,
      errors: section.visible ? merge(section.repeat, section.errors) : section.errors,
      entries: section.entries.map((entry) => ({
        ...entry,
        items: entry.items.map((item) => {
          const merged = item.visible ? { ...item, errors: merge(item.path, item.errors) } : item;
          items[merged.path] = merged;

          return merged;
        }),
      })),
    }));

    const valid =
      step.valid &&
      sections.every(
        (section) =>
          section.errors.length === 0 &&
          section.entries.every((entry) => entry.items.every((item) => item.errors.length === 0)),
      );

    return { ...step, sections, valid };
  });

  return { steps, items, valid: steps.every((step) => !step.visible || step.valid) };
}

function FormSkeleton() {
  return (
    <div className="grid gap-6" aria-busy>
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

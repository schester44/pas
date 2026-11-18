import { createScope, type ExpressionScope } from "@pas/expressions";
import type { FormDefinition, FormItem, FormSection, FormStep } from "./form";
import { getAt, joinPath, setAt } from "./paths";
import { indexSchema, isField, type RiskSchema, type SchemaIndex, type SchemaNode } from "./schema";
import { coerce, defaultMessages, isEmpty, toExpressionValue, type Messages } from "./values";

export interface ItemState {
  path: string;
  visible: boolean;
  required: boolean;
  errors: string[];
}

export interface EntryState {
  index: number | null;
  items: ItemState[];
}

export interface SectionState {
  id: string;
  repeat?: string;
  visible: boolean;
  errors: string[];
  entries: EntryState[];
}

export interface StepState {
  id: string;
  visible: boolean;
  valid: boolean;
  sections: SectionState[];
}

export interface FormState {
  steps: StepState[];
  items: Record<string, ItemState>;
  valid: boolean;
}

export interface EvaluateOptions {
  messages?: Messages;
}

export interface Evaluation {
  state: FormState;
  values: Map<string, unknown>;
  repeats: Map<string, number>;
}

const indexes = new WeakMap<RiskSchema, SchemaIndex>();

export function schemaIndex(schema: RiskSchema): SchemaIndex {
  let index = indexes.get(schema);

  if (!index) {
    index = indexSchema(schema);
    indexes.set(schema, index);
  }

  return index;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function expressionData(nodes: SchemaNode[], data: unknown): Record<string, unknown> {
  const source = isRecord(data) ? data : {};
  const out: Record<string, unknown> = {};

  for (const node of nodes) {
    const value = source[node.key];

    if (node.kind === "group") out[node.key] = expressionData(node.children, value);
    else if (node.kind === "repeatable") {
      out[node.key] = Array.isArray(value)
        ? value.map((row) => expressionData(node.children, row))
        : [];
    } else if (isEmpty(node, value)) out[node.key] = null;
    else {
      const coerced = coerce(node, value);
      out[node.key] = coerced.ok ? toExpressionValue(node, coerced.value) : null;
    }
  }

  return out;
}

function holds(scope: ExpressionScope, expression: string | undefined, fallback: boolean): boolean {
  if (!expression) return fallback;

  try {
    return scope.evaluate(expression) === true;
  } catch {
    // Most runtime errors are comparisons against a value the user hasn't entered yet.
    return false;
  }
}

function fails(scope: ExpressionScope, expression: string): boolean {
  try {
    return scope.evaluate(expression) !== true;
  } catch {
    return false;
  }
}

class Pass {
  readonly values = new Map<string, unknown>();
  readonly repeats = new Map<string, number>();
  readonly items: Record<string, ItemState> = {};

  constructor(
    private readonly index: SchemaIndex,
    private readonly data: unknown,
    private readonly context: Record<string, unknown>,
    private readonly messages: Messages,
  ) {}

  step(scope: ExpressionScope, step: FormStep): StepState {
    const visible = holds(scope, step.visibleWhen, true);
    const sections = step.sections.map((section) => this.section(scope, section, visible));

    const valid = sections.every(
      (section) =>
        section.errors.length === 0 &&
        section.entries.every((entry) => entry.items.every((item) => item.errors.length === 0)),
    );

    return { id: step.id, visible, valid, sections };
  }

  private section(
    scope: ExpressionScope,
    section: FormSection,
    stepVisible: boolean,
  ): SectionState {
    const visible = stepVisible && holds(scope, section.visibleWhen, true);

    if (!section.repeat) {
      const items = section.items.map((item) => this.item(scope, item, item.path, visible));

      return { id: section.id, visible, errors: [], entries: [{ index: null, items }] };
    }

    const repeat = section.repeat;
    const rows = getAt(this.data, repeat);
    const count = Array.isArray(rows) ? rows.length : 0;

    if (visible) this.repeats.set(repeat, count);

    const entries = Array.from({ length: count }, (_, index) => {
      const base = `${repeat}[${index}]`;
      const rowScope = scope.with("$item", getAt(this.context, base) ?? {});
      const itemScope = rowScope.with("$index", index);

      const items = section.items.map((item) =>
        this.item(itemScope, item, joinPath(base, item.path), visible),
      );

      itemScope.dispose();
      rowScope.dispose();

      return { index, items };
    });

    const errors = visible ? this.countErrors(repeat, count) : [];

    return { id: section.id, repeat, visible, errors, entries };
  }

  private countErrors(repeat: string, count: number): string[] {
    const node = this.index.get(repeat);

    if (node?.kind !== "repeatable") return [];

    if (node.minItems !== undefined && count < node.minItems) {
      return [this.messages.minItems(node.minItems)];
    }

    if (node.maxItems !== undefined && count > node.maxItems) {
      return [this.messages.maxItems(node.maxItems)];
    }

    return [];
  }

  private item(
    scope: ExpressionScope,
    item: FormItem,
    path: string,
    parentVisible: boolean,
  ): ItemState {
    const field = this.index.get(path.replace(/\[\d+\]/g, "[]"));
    const visible = parentVisible && isField(field) && holds(scope, item.visibleWhen, true);
    const state: ItemState = { path, visible, required: false, errors: [] };
    this.items[path] = state;

    if (!visible || !isField(field)) return state;

    state.required = item.required === true || holds(scope, item.requiredWhen, false);
    const raw = getAt(this.data, path);

    if (isEmpty(field, raw)) {
      if (state.required) state.errors.push(this.messages.required(field));

      return state;
    }

    const coerced = coerce(field, raw, this.messages);

    if (!coerced.ok) {
      state.errors.push(coerced.message);

      return state;
    }

    this.values.set(path, coerced.value);

    for (const validation of item.validations ?? []) {
      if (fails(scope, validation.expression)) state.errors.push(validation.message);
    }

    return state;
  }
}

function hiddenPaths(state: FormState): string[] {
  return Object.values(state.items)
    .filter((item) => !item.visible)
    .map((item) => item.path)
    .toSorted();
}

// Hiding a field nulls its value, which can hide fields that depend on it; iterate to a fixpoint.
const MAX_PASSES = 8;

export function evaluate(
  schema: RiskSchema,
  form: FormDefinition,
  data: unknown,
  options: EvaluateOptions = {},
): Evaluation {
  const index = schemaIndex(schema);
  const messages = options.messages ?? defaultMessages;
  const base = expressionData(schema.fields, data);
  let hidden: string[] = [];
  let result: Evaluation | undefined;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const context = hidden.reduce<Record<string, unknown>>(
      (acc, path) => setAt(acc, path, null),
      base,
    );

    const scope = createScope(context);

    try {
      const run = new Pass(index, data, context, messages);
      const steps = form.steps.map((step) => run.step(scope, step));

      const state: FormState = {
        steps,
        items: run.items,
        valid: steps.every((step) => step.valid),
      };

      result = { state, values: run.values, repeats: run.repeats };
    } finally {
      scope.dispose();
    }

    const next = hiddenPaths(result.state);

    if (next.join("\n") === hidden.join("\n")) break;

    hidden = next;
  }

  return result!;
}

export function evaluateForm(
  schema: RiskSchema,
  form: FormDefinition,
  data: unknown,
  options: EvaluateOptions = {},
): FormState {
  return evaluate(schema, form, data, options).state;
}

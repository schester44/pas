import {
  type FieldNode,
  type FormDefinition,
  type FormItem,
  type FormSection,
  type FormStep,
  type IndexedNode,
  isField,
  type ReferenceIssue,
  type RiskSchema,
  schemaIndex,
} from "@pas/forms-core";

export interface FormSel {
  step?: number;
  section?: number;
  item?: number;
}

export type Level = "form" | "step" | "section" | "item";

export const levelOf = (sel: FormSel): Level =>
  sel.item !== undefined
    ? "item"
    : sel.section !== undefined
      ? "section"
      : sel.step !== undefined
        ? "step"
        : "form";

export const selId = (sel: FormSel) =>
  [sel.step, sel.section, sel.item].filter((part) => part !== undefined).join(".") || "form";

export function parseSelId(id: string): FormSel {
  if (id === "form") return {};

  const [step, section, item] = id.split(".").map(Number);

  return { step, section, item };
}

const replace = <T>(list: T[], index: number, fn: (value: T) => T) =>
  list.map((value, i) => (i === index ? fn(value) : value));

export function updateStep(form: FormDefinition, step: number, fn: (step: FormStep) => FormStep) {
  return { ...form, steps: replace(form.steps, step, fn) };
}

export function updateSection(
  form: FormDefinition,
  sel: FormSel,
  fn: (section: FormSection) => FormSection,
) {
  return updateStep(form, sel.step!, (step) => ({
    ...step,
    sections: replace(step.sections, sel.section!, fn),
  }));
}

export function updateItem(form: FormDefinition, sel: FormSel, fn: (item: FormItem) => FormItem) {
  return updateSection(form, sel, (section) => ({
    ...section,
    items: replace(section.items, sel.item!, fn),
  }));
}

function editSiblings(
  form: FormDefinition,
  sel: FormSel,
  edit: <T>(list: T[]) => T[],
): FormDefinition {
  switch (levelOf(sel)) {
    case "step":
      return { ...form, steps: edit(form.steps) };
    case "section":
      return updateStep(form, sel.step!, (step) => ({ ...step, sections: edit(step.sections) }));
    case "item":
      return updateSection(form, sel, (section) => ({ ...section, items: edit(section.items) }));
    default:
      return form;
  }
}

const indexAt = (sel: FormSel) => sel.item ?? sel.section ?? sel.step ?? 0;

const withIndex = (sel: FormSel, index: number): FormSel => {
  const level = levelOf(sel);

  return level === "item"
    ? { ...sel, item: index }
    : level === "section"
      ? { ...sel, section: index }
      : { step: index };
};

export function siblingCount(form: FormDefinition, sel: FormSel): number {
  const step = form.steps[sel.step ?? -1];
  const section = step?.sections[sel.section ?? -1];

  switch (levelOf(sel)) {
    case "step":
      return form.steps.length;
    case "section":
      return step?.sections.length ?? 0;
    case "item":
      return section?.items.length ?? 0;
    default:
      return 0;
  }
}

export function moveSel(form: FormDefinition, sel: FormSel, delta: -1 | 1) {
  const index = indexAt(sel);
  const target = index + delta;

  if (target < 0 || target >= siblingCount(form, sel)) return undefined;

  const next = editSiblings(form, sel, (list) => {
    const copy = [...list];
    [copy[index], copy[target]] = [copy[target]!, copy[index]!];

    return copy;
  });

  return { form: next, sel: withIndex(sel, target) };
}

export function removeSel(form: FormDefinition, sel: FormSel) {
  const index = indexAt(sel);
  const next = editSiblings(form, sel, (list) => list.filter((_, i) => i !== index));
  const remaining = siblingCount(next, sel);

  const parent: FormSel =
    levelOf(sel) === "item"
      ? { step: sel.step, section: sel.section }
      : levelOf(sel) === "section"
        ? { step: sel.step }
        : {};

  return {
    form: next,
    sel: remaining > 0 ? withIndex(sel, Math.min(index, remaining - 1)) : parent,
  };
}

export function insertSel<T>(form: FormDefinition, sel: FormSel, value: T) {
  const index = indexAt(sel);

  return editSiblings(form, sel, (list) => list.toSpliced(index, 0, value as never));
}

export function duplicateSel(form: FormDefinition, sel: FormSel) {
  const index = indexAt(sel);

  const next = editSiblings(form, sel, (list) => {
    const copy = structuredClone(list[index]) as never as Record<string, unknown>;

    if (typeof copy.id === "string") {
      copy.id = uniqueId(
        list.map((entry) => (entry as { id?: string }).id ?? ""),
        `${copy.id}_copy`,
      );
    }

    return list.toSpliced(index + 1, 0, copy as never);
  });

  return { form: next, sel: withIndex(sel, index + 1) };
}

export function uniqueId(taken: readonly string[], base: string): string {
  const set = new Set(taken);

  if (!set.has(base)) return base;

  let n = 2;

  while (set.has(`${base}_${n}`)) n++;

  return `${base}_${n}`;
}

export interface Bindable {
  path: string;
  node: IndexedNode & FieldNode;
  group: string;
}

export function bindableFields(schema: RiskSchema, repeat?: string): Bindable[] {
  const index = schemaIndex(schema);
  const prefix = repeat ? `${repeat}[].` : "";
  const out: Bindable[] = [];

  for (const [path, node] of index) {
    if (!isField(node) || !path.startsWith(prefix)) continue;

    const relative = path.slice(prefix.length);

    if (relative.includes("[]")) continue;

    const dot = path.lastIndexOf(".");
    const parentPath = dot < 0 ? "" : path.slice(0, dot).replace(/\[\]$/, "");
    const group = parentPath ? (index.get(parentPath)?.label ?? parentPath) : "";
    out.push({ path: relative, node: node as IndexedNode & FieldNode, group });
  }

  return out;
}

export function rootRepeatables(schema: RiskSchema) {
  return [...schemaIndex(schema).values()].filter(
    (node) => node.kind === "repeatable" && !node.path.includes("[]"),
  );
}

export function fieldFor(schema: RiskSchema, path: string, repeat?: string) {
  const node = schemaIndex(schema).get(repeat ? `${repeat}[].${path}` : path);

  return isField(node) ? node : undefined;
}

export interface Suggestion {
  insert: string;
  label: string;
  kind: string;
}

export function expressionSuggestions(schema: RiskSchema, repeat?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const index = schemaIndex(schema);

  if (repeat) {
    for (const [path, node] of index) {
      if (!path.startsWith(`${repeat}[].`)) continue;

      const relative = path.slice(repeat.length + 3);

      if (!relative.includes("[]"))
        out.push({ insert: `$item.${relative}`, label: node.label, kind: node.kind });
    }

    out.push({ insert: "$index", label: "Entry position, from 0", kind: "integer" });
  }

  for (const [path, node] of index) {
    if (!path.includes("[]")) out.push({ insert: path, label: node.label, kind: node.kind });
  }

  return out;
}

export function locate(form: FormDefinition, issue: ReferenceIssue): FormSel {
  const step = form.steps.findIndex((candidate) => candidate.id === issue.step);

  if (step < 0) return {};

  if (issue.section === undefined) return { step };

  const sections = form.steps[step]!.sections;
  const section = sections.findIndex((candidate) => candidate.id === issue.section);

  if (section < 0) return { step };

  if (issue.item === undefined) return { step, section };

  const item = sections[section]!.items.findIndex((candidate) => candidate.path === issue.item);

  return item < 0 ? { step, section } : { step, section, item };
}

export function issuesAt(form: FormDefinition, issues: ReferenceIssue[], sel: FormSel) {
  const id = selId(sel);

  return issues.filter((issue) => selId(locate(form, issue)) === id);
}

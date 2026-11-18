import { referencedPaths } from "@pas/expressions";
import { schemaIndex } from "./evaluate";
import type { FormDefinition, FormItem, FormSection, Widget } from "./form";
import { joinPath } from "./paths";
import {
  type FieldKind,
  isField,
  resolvesInSchema,
  type RiskSchema,
  type SchemaIndex,
} from "./schema";

export interface ReferenceIssue {
  step: string;
  section?: string;
  item?: string;
  property: string;
  message: string;
}

export const WIDGET_KINDS: Record<Widget, readonly FieldKind[]> = {
  textarea: ["text"],
  select: ["enum"],
  radio: ["enum", "boolean"],
  checkbox: ["boolean"],
  checkboxes: ["multi_enum"],
};

type Where = Omit<ReferenceIssue, "property" | "message">;

class Checker {
  readonly issues: ReferenceIssue[] = [];

  constructor(private readonly index: SchemaIndex) {}

  report(where: Where, property: string, message: string) {
    this.issues.push({ ...where, property, message });
  }

  expression(where: Where, property: string, expression: string | undefined, repeat?: string) {
    if (!expression) return;

    let paths: string[];

    try {
      paths = referencedPaths(expression, {
        aliases: repeat ? { $item: `${repeat}[]`, $index: null } : {},
      });
    } catch (error) {
      this.report(where, property, (error as Error).message);

      return;
    }

    for (const path of paths) {
      if (!resolvesInSchema(this.index, path)) this.report(where, property, `Unknown path ${path}`);
    }
  }

  repeat(where: Where, repeat: string) {
    const node = this.index.get(repeat);

    if (!node) this.report(where, "repeat", `Unknown path ${repeat}`);
    else if (node.kind !== "repeatable")
      this.report(where, "repeat", `${repeat} isn't a repeatable`);
    else if (repeat.includes("[]")) {
      this.report(where, "repeat", `${repeat} is inside another repeatable`);
    }
  }

  item(where: Where, item: FormItem, repeat: string | undefined) {
    const path = repeat ? joinPath(`${repeat}[]`, item.path) : item.path;
    const node = this.index.get(path);

    if (!node) this.report(where, "path", `Unknown path ${path}`);
    else if (!isField(node)) this.report(where, "path", `${path} is a ${node.kind}, not a field`);
    else if (!repeat && path.includes("[]")) {
      this.report(where, "path", `${path} is inside a repeatable; bind it in a repeating section`);
    } else if (item.widget && !WIDGET_KINDS[item.widget].includes(node.kind)) {
      this.report(where, "widget", `The ${item.widget} widget doesn't fit ${node.kind} fields`);
    }

    if (repeat && item.path.includes("[]")) {
      this.report(where, "path", `${item.path} crosses a nested repeatable`);
    }

    this.expression(where, "visibleWhen", item.visibleWhen, repeat);
    this.expression(where, "requiredWhen", item.requiredWhen, repeat);

    item.validations?.forEach((validation, i) =>
      this.expression(where, `validations[${i}]`, validation.expression, repeat),
    );
  }

  section(step: string, section: FormSection) {
    const where = { step, section: section.id };
    this.expression(where, "visibleWhen", section.visibleWhen);

    if (section.repeat) this.repeat(where, section.repeat);

    const seen = new Set<string>();

    for (const item of section.items) {
      if (seen.has(item.path)) this.report({ ...where, item: item.path }, "path", "Bound twice");

      seen.add(item.path);
      this.item({ ...where, item: item.path }, item, section.repeat);
    }
  }
}

export function checkReferences(schema: RiskSchema, form: FormDefinition): ReferenceIssue[] {
  const checker = new Checker(schemaIndex(schema));
  const ids = new Set<string>();

  for (const step of form.steps) {
    if (ids.has(step.id)) checker.report({ step: step.id }, "id", "Duplicate step id");

    ids.add(step.id);
    checker.expression({ step: step.id }, "visibleWhen", step.visibleWhen);

    for (const section of step.sections) {
      const key = `${step.id}/${section.id}`;

      if (ids.has(key))
        checker.report({ step: step.id, section: section.id }, "id", "Duplicate section id");

      ids.add(key);
      checker.section(step.id, section);
    }
  }

  return checker.issues;
}

import {
  coerce,
  type FieldNode,
  type FormDefinition,
  joinPath,
  type RiskSchema,
  type SchemaNode,
} from "@pas/forms-core";
import { invalid, isRecord } from "@pas/kernel";
import type { FieldChange } from "./transaction";

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);

  if (value === null || typeof value !== "object") return value === "" ? undefined : value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([k, v]) => [k, clean(v)] as const)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

/** Equal as data: key order, empty strings and missing optional fields don't count. */
export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(clean(a) ?? null) === JSON.stringify(clean(b) ?? null);

const same = sameValue;

/**
 * Applies only the RiskSchema's `endorsable` fields from `proposed` onto `current` (PLAN §7.4).
 * Everything else, including how many entries a repeatable has, stays as issued.
 */
export function applyEndorsableChanges(
  schema: RiskSchema,
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): { risk: Record<string, unknown>; changes: FieldChange[] } {
  const changes: FieldChange[] = [];

  const walk = (nodes: SchemaNode[], from: unknown, to: unknown, base: string, label: string) => {
    const out: Record<string, unknown> = isRecord(from) ? { ...from } : {};
    const next = isRecord(to) ? to : {};

    for (const node of nodes) {
      const path = joinPath(base, node.key);
      const title = label ? `${label} · ${node.label}` : node.label;

      if (node.kind === "group") {
        out[node.key] = walk(node.children, out[node.key], next[node.key], path, title);
      } else if (node.kind === "repeatable") {
        const rows = Array.isArray(out[node.key]) ? (out[node.key] as unknown[]) : [];
        const proposedRows = Array.isArray(next[node.key]) ? (next[node.key] as unknown[]) : [];

        out[node.key] = rows.map((row, index) =>
          walk(
            node.children,
            row,
            proposedRows[index],
            `${path}[${index}]`,
            rows.length > 1 ? `${node.label} ${index + 1}` : node.label,
          ),
        );
      } else if (node.endorsable && node.key in next) {
        const after = validatedValue(node, path, title, next[node.key]);

        if (same(out[node.key], after)) continue;

        changes.push({ path, label: title, before: out[node.key] ?? null, after });
        out[node.key] = after;
      }
    }

    return out;
  };

  return { risk: walk(schema.fields, current, proposed, "", ""), changes };
}

function endorsablePaths(nodes: SchemaNode[], base = ""): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    const path = joinPath(base, node.key);

    if (node.kind === "group" || node.kind === "repeatable") {
      const child = node.kind === "repeatable" ? `${path}[]` : path;

      for (const p of endorsablePaths(node.children, child)) paths.add(p);
    } else if (node.endorsable) {
      paths.add(path);
    }
  }

  return paths;
}

/** The release's endorsement form, or its quote form narrowed to the endorsable fields. */
export function endorsementForm(
  schema: RiskSchema,
  forms: readonly { channel: string; stage: string; form: FormDefinition }[],
): FormDefinition | null {
  const own = forms.find((f) => f.stage === "endorsement");

  if (own) return own.form;

  const quote =
    forms.find((f) => f.stage === "quote" && f.channel === "agent") ??
    forms.find((f) => f.stage === "quote");

  if (!quote) return null;

  const paths = endorsablePaths(schema.fields);

  const steps = quote.form.steps
    .map((step) => ({
      ...step,
      sections: step.sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) =>
            paths.has(section.repeat ? `${section.repeat}[].${item.path}` : item.path),
          ),
        }))
        .filter((section) => section.items.length > 0),
    }))
    .filter((step) => step.sections.length > 0);

  return steps.length > 0 ? { ...quote.form, key: `${quote.form.key}-endorsement`, steps } : null;
}

function validatedValue(field: FieldNode, path: string, label: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;

  const result = coerce(field, value);

  if (!result.ok) throw invalid(`${label}: ${result.message}`, { path });

  return result.value;
}

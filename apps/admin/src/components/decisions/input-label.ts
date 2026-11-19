import { indexSchema, type RiskSchema, type SchemaIndex } from "@pas/forms-core";
import { humanize } from "./jdm-edit";

const AGGREGATES: Record<string, string> = {
  max: "Highest",
  min: "Lowest",
  sum: "Total",
  avg: "Average",
  some: "Any",
  all: "Every",
  none: "No",
  count: "Number of",
};

const PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const MAPPED = /^(\w+)\(\s*map\(\s*([\w.]+)\s*,\s*#\.([\w.]+)\s*\)\s*\)$/;
const PREDICATE = /^(\w+)\(\s*([\w.]+)\s*,\s*#\.([\w.]+)\s*\)$/;

const lower = (label: string) => (/^[A-Z][a-z]/.test(label) ? label.toLowerCase() : label);

function fieldLabel(index: SchemaIndex, path: string) {
  return index.get(path)?.label ?? humanize(path.split(".").at(-1) ?? path);
}

/** A readable name for a decision input expression, from the risk schema's labels. */
export function expressionLabel(expression: string, index: SchemaIndex): string | null {
  const field = expression.trim();

  if (PATH.test(field)) return index.has(field) ? fieldLabel(index, field) : humanize(field);

  const match = MAPPED.exec(field) ?? PREDICATE.exec(field);
  const aggregate = match && AGGREGATES[match[1]!];

  if (!match || !aggregate) return null;

  const label = lower(fieldLabel(index, `${match[2]}[].${match[3]}`));
  const collection = index.get(match[2]!);
  const entry = collection && "exposure" in collection && collection.exposure;

  return PREDICATE.test(field) && entry
    ? `${aggregate} ${humanize(entry).toLowerCase()} ${label}`
    : `${aggregate} ${label}`;
}

const REFERENCE = /[A-Za-z_$][\w$]*(?:\[\d*\])?(?:\.[A-Za-z_$][\w$]*(?:\[\d*\])?)*/;

function referenceLabel(expression: string, index: SchemaIndex): string {
  const path = REFERENCE.exec(expression)?.[0];

  if (!path) return "Rule input";

  const canonical = path.replace(/\[\d*\]/g, "[]");

  return index.has(canonical)
    ? fieldLabel(index, canonical)
    : humanize(canonical.split(".").at(-1)!.replace("[]", ""));
}

export function inputLabeler(schema: RiskSchema | undefined) {
  const index = schema ? indexSchema(schema) : new Map();

  return (expression: string, name?: string) =>
    name?.trim() || expressionLabel(expression, index) || referenceLabel(expression, index);
}

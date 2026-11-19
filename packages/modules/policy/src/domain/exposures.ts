import {
  type FieldNode,
  type FormDefinition,
  getAt,
  isField,
  legacyRowId,
  type RepeatableNode,
  type RiskSchema,
  rowIdOf,
  rowPath,
  schemaIndex,
} from "@pas/forms-core";
import { isRecord } from "@pas/kernel";

const BY_INDEX = /^(.*)\[(\d+)\]$/;
const BY_ID = /^(.*)\[#([^\]]+)\]$/;

const rowsAt = (risk: unknown, path: string) => {
  const rows = getAt(risk, path);

  return Array.isArray(rows) ? rows : [];
};

const idAt = (rows: unknown[], index: number) => rowIdOf(rows[index]) ?? legacyRowId(index);

/**
 * Exposure keys follow the row id (`locations[#…]`), so a location keeps its premium lines when
 * another is removed. Keys stored by position (`locations[1]`) read as the row at that position.
 */
export function stableExposure(risk: unknown, exposure: string | undefined): string | undefined {
  const match = exposure ? BY_INDEX.exec(exposure) : null;

  if (!match) return exposure;

  const index = Number(match[2]);
  const rows = rowsAt(risk, match[1]!);

  return index < rows.length ? rowPath(match[1]!, idAt(rows, index)) : exposure;
}

/** The rater addresses rows by position; null when the row is no longer there. */
export function indexedExposure(
  risk: unknown,
  exposure: string | undefined,
): string | undefined | null {
  const match = exposure ? BY_ID.exec(exposure) : null;

  if (!match) return exposure;

  const rows = rowsAt(risk, match[1]!);
  const index = rows.findIndex((_, i) => idAt(rows, i) === match[2]);

  return index < 0 ? null : `${match[1]}[${index}]`;
}

export const withStableExposure = <T extends { exposure?: string }>(risk: unknown, line: T): T => {
  const exposure = stableExposure(risk, line.exposure);

  return exposure === line.exposure ? line : { ...line, exposure: exposure! };
};

/** The singular a form uses for a repeatable's entries ("Location"), else the schema label. */
export function rowNoun(path: string, node: RepeatableNode, forms: readonly FormDefinition[]) {
  for (const form of forms) {
    for (const step of form.steps) {
      const section = step.sections.find((s) => s.repeat === path && s.itemLabel);

      if (section?.itemLabel) return section.itemLabel;
    }
  }

  return node.label;
}

/** What tells a row apart for people: its first address line, else its first text answer. */
export function rowSummary(node: RepeatableNode, row: unknown): string | null {
  if (!isRecord(row)) return null;

  const fields = node.children.filter(isField) as FieldNode[];
  const address = fields.find((f) => f.kind === "address");
  const value = address ? row[address.key] : null;

  if (isRecord(value) && typeof value.line1 === "string" && value.line1.trim()) {
    return value.line1.trim();
  }

  for (const field of fields.filter((f) => f.kind === "text")) {
    const text = row[field.key];

    if (typeof text === "string" && text.trim()) return text.trim();
  }

  return null;
}

export const rowTitle = (noun: string, position: number | null, summary: string | null) =>
  `${noun}${position === null ? "" : ` ${position}`}${summary ? ` (${summary})` : ""}`;

/**
 * People-facing names for exposure keys across the risks a change touches: "Location 2 (12 Main
 * St)". The first risk that has the row names it.
 */
export function exposureLabels(
  schema: RiskSchema,
  forms: readonly FormDefinition[],
  risks: readonly unknown[],
  exposures: Iterable<string | undefined>,
): Record<string, string> {
  const index = schemaIndex(schema);
  const labels: Record<string, string> = {};

  for (const exposure of new Set(exposures)) {
    if (!exposure || labels[exposure]) continue;

    const match = BY_ID.exec(exposure) ?? BY_INDEX.exec(exposure);
    const parent = match?.[1];
    const node = parent ? index.get(parent.replace(/\[[^\]]*\]/g, "[]")) : undefined;

    if (!match || node?.kind !== "repeatable") continue;

    const noun = rowNoun(parent!, node, forms);

    for (const risk of risks) {
      const rows = rowsAt(risk, parent!);

      const at = BY_ID.test(exposure)
        ? rows.findIndex((_, i) => idAt(rows, i) === match[2])
        : Number(match[2]);

      if (at < 0 || at >= rows.length) continue;

      labels[exposure] = rowTitle(noun, at + 1, rowSummary(node, rows[at]));
      break;
    }
  }

  return labels;
}

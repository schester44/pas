import {
  canonicalPath,
  type FormDefinition,
  getAt,
  joinPath,
  parsePath,
  type RepeatableNode,
  type RiskSchema,
  rowIdOf,
  rowPath,
  type SchemaNode,
  setAt,
} from "@pas/forms-core";
import { isRecord } from "@pas/kernel";
import { sameValue } from "./same-value";
import { rowNoun, rowSummary, rowTitle } from "./exposures";
import type { FieldChange } from "./transaction";

/** One change to risk data, addressed by row id so it can be re-applied on another state. */
export type RiskEdit =
  | { op: "set"; path: string; value: unknown }
  | { op: "add"; path: string; row: Record<string, unknown> }
  | { op: "remove"; path: string };

const rowsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const byId = (rows: unknown[]) =>
  new Map(rows.flatMap((row) => (rowIdOf(row) ? [[rowIdOf(row)!, row] as const] : [])));

/** What turned `before` into `after`, field by field and row by row (both carry row ids). */
export function riskEdits(
  schema: RiskSchema,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RiskEdit[] {
  const edits: RiskEdit[] = [];

  const walk = (nodes: SchemaNode[], from: unknown, to: unknown, base: string) => {
    const a = isRecord(from) ? from : {};
    const b = isRecord(to) ? to : {};

    for (const node of nodes) {
      const path = joinPath(base, node.key);

      if (node.kind === "group") walk(node.children, a[node.key], b[node.key], path);
      else if (node.kind === "repeatable") {
        const was = byId(rowsOf(a[node.key]));
        const now = byId(rowsOf(b[node.key]));

        for (const [id, row] of was) {
          const next = now.get(id);

          if (next) walk(node.children, row, next, rowPath(path, id));
          else edits.push({ op: "remove", path: rowPath(path, id) });
        }

        for (const [id, row] of now) {
          if (!was.has(id)) edits.push({ op: "add", path, row: row as Record<string, unknown> });
        }
      } else if (!sameValue(a[node.key], b[node.key])) {
        edits.push({ op: "set", path, value: b[node.key] ?? null });
      }
    }
  };

  walk(schema.fields, before, after, "");

  return edits;
}

/** Every row a path goes through is still there. */
function reachable(risk: unknown, path: string): boolean {
  const segments = parsePath(path);
  let prefix = "";

  for (const segment of segments) {
    prefix =
      typeof segment === "string"
        ? joinPath(prefix, segment)
        : typeof segment === "number"
          ? `${prefix}[${segment}]`
          : rowPath(prefix, segment.id);

    if (typeof segment !== "string" && getAt(risk, prefix) === undefined) return false;
  }

  return true;
}

/** Re-applies edits onto another state; edits to rows that are gone come back as `skipped`. */
export function applyRiskEdits(
  risk: Record<string, unknown>,
  edits: readonly RiskEdit[],
): { risk: Record<string, unknown>; skipped: RiskEdit[] } {
  let out = risk;
  const skipped: RiskEdit[] = [];

  for (const edit of edits) {
    if (!reachable(out, edit.path)) {
      skipped.push(edit);
      continue;
    }

    if (edit.op === "set") {
      out = setAt(out, edit.path, edit.value === null ? undefined : edit.value);
    } else if (edit.op === "add") {
      const rows = rowsOf(getAt(out, edit.path));

      if (rows.some((row) => rowIdOf(row) === rowIdOf(edit.row))) skipped.push(edit);
      else out = setAt(out, edit.path, [...rows, edit.row]);
    } else {
      const parent = edit.path.slice(0, edit.path.lastIndexOf("[#"));
      const id = edit.path.slice(parent.length + 2, -1);

      out = setAt(
        out,
        parent,
        rowsOf(getAt(out, parent)).filter((row) => rowIdOf(row) !== id),
      );
    }
  }

  return { risk: out, skipped };
}

/**
 * The changes people read: "Location 2 (12 Main St) · Roof age", "Location 3 added",
 * "Location 1 (4 Elm Rd) removed". Rows are numbered by their place in `before`; added ones
 * by their place in `after`.
 */
export function describeChanges(
  schema: RiskSchema,
  forms: readonly FormDefinition[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];

  const walk = (nodes: SchemaNode[], from: unknown, to: unknown, base: string, label: string) => {
    const a = isRecord(from) ? from : {};
    const b = isRecord(to) ? to : {};

    for (const node of nodes) {
      const path = joinPath(base, node.key);
      const title = label ? `${label} · ${node.label}` : node.label;

      if (node.kind === "group") walk(node.children, a[node.key], b[node.key], path, title);
      else if (node.kind === "repeatable")
        rows(node, path, rowsOf(a[node.key]), rowsOf(b[node.key]));
      else if (!sameValue(a[node.key], b[node.key])) {
        changes.push({
          path,
          label: title,
          before: a[node.key] ?? null,
          after: b[node.key] ?? null,
        });
      }
    }
  };

  const rows = (node: RepeatableNode, path: string, was: unknown[], now: unknown[]) => {
    const noun = rowNoun(canonicalPath(path), node, forms);
    const next = byId(now);
    const several = was.length > 1;

    was.forEach((row, index) => {
      const id = rowIdOf(row);
      const summary = rowSummary(node, row);
      const title = rowTitle(noun, several ? index + 1 : null, summary);

      if (!id) return;

      const kept = next.get(id);

      if (kept) walk(node.children, row, kept, rowPath(path, id), title);
      else {
        changes.push({
          path: rowPath(path, id),
          label: `${rowTitle(noun, index + 1, summary)} removed`,
          before: summary ?? title,
          after: null,
        });
      }
    });

    const known = new Set(was.map(rowIdOf));

    now.forEach((row, index) => {
      const id = rowIdOf(row);

      if (!id || known.has(id)) return;

      const summary = rowSummary(node, row);

      changes.push({
        path: rowPath(path, id),
        label: `${rowTitle(noun, index + 1, summary)} added`,
        before: null,
        after: summary ?? `${noun} ${index + 1}`,
      });
    });
  };

  walk(schema.fields, before, after, "", "");

  return changes;
}

export interface CoverageChoiceLike {
  coverage: string;
  exposure?: string;
  limit?: unknown;
  deductible?: unknown;
}

export type CoverageEdit =
  | { op: "put"; choice: CoverageChoiceLike }
  | { op: "remove"; coverage: string; exposure?: string };

export const coverageKey = (c: { coverage: string; exposure?: string }) =>
  `${c.coverage}@${c.exposure ?? ""}`;

const choiceOnly = (c: CoverageChoiceLike): CoverageChoiceLike => ({
  coverage: c.coverage,
  ...(c.exposure !== undefined && { exposure: c.exposure }),
  ...(c.limit !== undefined && { limit: c.limit }),
  ...(c.deductible !== undefined && { deductible: c.deductible }),
});

/** Coverages chosen, dropped or re-limited between two selections (exposures by row id). */
export function coverageEdits(
  before: readonly CoverageChoiceLike[],
  after: readonly CoverageChoiceLike[],
): CoverageEdit[] {
  const was = new Map(before.map((c) => [coverageKey(c), c]));
  const now = new Map(after.map((c) => [coverageKey(c), c]));
  const edits: CoverageEdit[] = [];

  for (const [key, c] of now) {
    const old = was.get(key);

    if (!old || !sameValue(old.limit, c.limit) || !sameValue(old.deductible, c.deductible)) {
      edits.push({ op: "put", choice: choiceOnly(c) });
    }
  }

  for (const [key, c] of was) {
    if (!now.has(key)) {
      edits.push({
        op: "remove",
        coverage: c.coverage,
        ...(c.exposure !== undefined && { exposure: c.exposure }),
      });
    }
  }

  return edits;
}

export function applyCoverageEdits(
  choices: readonly CoverageChoiceLike[],
  edits: readonly CoverageEdit[],
): CoverageChoiceLike[] {
  const out = new Map(choices.map((c) => [coverageKey(c), choiceOnly(c)]));

  for (const edit of edits) {
    if (edit.op === "put") out.set(coverageKey(edit.choice), edit.choice);
    else out.delete(coverageKey(edit));
  }

  return [...out.values()];
}

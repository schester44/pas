import {
  canonicalPath,
  coerce,
  type EndorsementContext,
  endorsePermit,
  type FieldNode,
  type FormDefinition,
  isConditional,
  joinPath,
  legacyRowId,
  newRow,
  type RepeatableNode,
  ROW_ID,
  type RiskSchema,
  rowIdOf,
  rowPath,
  type SchemaNode,
  validateSubmission,
  withRowIds,
} from "@pas/forms-core";
import { invalid, isRecord } from "@pas/kernel";
import { rowNoun, rowSummary, rowTitle } from "./exposures";
import { describeChanges } from "./risk-diff";
import { sameValue } from "./same-value";
import type { FieldChange } from "./transaction";

export { sameValue };

const same = sameValue;

/** A TermVersion's risk with every row's id; rows issued before ids existed get theirs by position. */
export const issuedRisk = (schema: RiskSchema, snapshot: Record<string, unknown>) =>
  withRowIds(schema, (snapshot.risk ?? {}) as Record<string, unknown>, legacyRowId);

export interface EndorseOptions {
  context: EndorsementContext;
  /** The intake form: rows added mid-term must answer it in full, like at quote. */
  form?: FormDefinition | null;
  forms?: readonly FormDefinition[];
}

const rowsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Proposals from clients that predate row ids pair their rows with the issued ones by position. */
function withIssuedIds(issued: unknown[], proposed: unknown[]): unknown[] {
  if (proposed.some((row) => rowIdOf(row))) return proposed;

  return proposed.map((row, i) => {
    const id = rowIdOf(issued[i]);

    return id && isRecord(row) ? { ...row, [ROW_ID]: id } : row;
  });
}

/**
 * Applies what the RiskSchema lets an endorsement change from `proposed` onto `current` (PLAN
 * §7.4): `endorsable` fields, matched to their row by row id, and added or removed rows where the
 * repeatable's own `endorsable` allows. Fields that can never change are ignored; a condition
 * that doesn't hold rejects the change with its reason.
 */
export function applyEndorsableChanges(
  schema: RiskSchema,
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  options: EndorseOptions,
): { risk: Record<string, unknown>; changes: FieldChange[] } {
  const issued = withRowIds(schema, current, legacyRowId);
  const added: { repeat: string; index: number; title: string }[] = [];
  const forms = options.forms ?? (options.form ? [options.form] : []);

  const permit = (node: FieldNode | RepeatableNode, title: string, row?: RowScope) => {
    const result = endorsePermit(schema, node.endorsable, issued, options.context, row);

    if (result.ok) return true;

    if (isConditional(node.endorsable)) throw invalid(`${title}: ${result.reason}`);

    return false;
  };

  const walk = (
    nodes: SchemaNode[],
    from: unknown,
    to: unknown,
    base: string,
    label: string,
    row?: RowScope,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = isRecord(from) ? { ...from } : {};
    const next = isRecord(to) ? to : {};

    for (const node of nodes) {
      const path = joinPath(base, node.key);
      const title = label ? `${label} · ${node.label}` : node.label;

      if (node.kind === "group") {
        out[node.key] = walk(node.children, out[node.key], next[node.key], path, title, row);
      } else if (node.kind === "repeatable") {
        if (node.key in next && Array.isArray(next[node.key])) {
          out[node.key] = rows(node, path, rowsOf(out[node.key]), rowsOf(next[node.key]));
        }
      } else if (node.key in next) {
        const after = validatedValue(node, path, title, next[node.key]);

        if (same(out[node.key], after) || !permit(node, title, row)) continue;

        out[node.key] = after;
      }
    }

    return out;
  };

  const rows = (node: RepeatableNode, path: string, issuedRows: unknown[], to: unknown[]) => {
    const noun = rowNoun(canonicalPath(path), node, forms);
    const proposedRows = withIssuedIds(issuedRows, to);
    const byId = new Map(proposedRows.flatMap((r) => (rowIdOf(r) ? [[rowIdOf(r)!, r]] : [])));
    const kept: unknown[] = [];
    const several = issuedRows.length > 1;

    issuedRows.forEach((row, index) => {
      const id = rowIdOf(row)!;
      const summary = rowSummary(node, row);
      const title = rowTitle(noun, index + 1, summary);
      const shown = several ? title : rowTitle(noun, null, summary);
      const proposedRow = byId.get(id);

      if (!proposedRow) {
        if (permit(node, `${title} removed`)) return;

        kept.push(row);

        return;
      }

      kept.push({
        ...walk(node.children, row, proposedRow, rowPath(path, id), shown, {
          repeatable: node,
          row,
        }),
        [ROW_ID]: id,
      });
    });

    const known = new Set(issuedRows.map(rowIdOf));
    const fresh = proposedRows.filter((r) => !known.has(rowIdOf(r)));

    for (const proposedRow of fresh) {
      const position = kept.length + 1;
      const title = `${noun} ${position}`;

      if (!permit(node, `${title} added`)) continue;

      const id = rowIdOf(proposedRow) ?? rowIdOf(newRow())!;

      const created = {
        ...newRowData(node.children, proposedRow, rowPath(path, id), title),
        [ROW_ID]: id,
      };

      if (!path.includes("[")) added.push({ repeat: path, index: kept.length, title });

      kept.push(created);
    }

    if (kept.length !== issuedRows.length) assertRowCount(node, noun, kept.length);

    return kept;
  };

  const risk = walk(schema.fields, issued, proposed, "", "");

  if (added.length > 0 && options.form) assertRowsComplete(schema, options.form, risk, added);

  return { risk, changes: describeChanges(schema, forms, issued, risk) };
}

type RowScope = { repeatable: RepeatableNode; row: unknown };

function assertRowCount(node: RepeatableNode, noun: string, count: number) {
  const noun1 = noun.toLowerCase();

  if (node.minItems !== undefined && count < node.minItems) {
    throw invalid(`Keep at least ${node.minItems} ${noun1}${node.minItems === 1 ? "" : "s"}`);
  }

  if (node.maxItems !== undefined && count > node.maxItems) {
    throw invalid(
      `This policy can have at most ${node.maxItems} ${noun1}${node.maxItems === 1 ? "" : "s"}`,
    );
  }
}

function newRowData(
  nodes: SchemaNode[],
  value: unknown,
  base: string,
  label: string,
): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  const out: Record<string, unknown> = {};

  for (const node of nodes) {
    const path = joinPath(base, node.key);
    const title = `${label} · ${node.label}`;
    const v = source[node.key];

    if (node.kind === "group") out[node.key] = newRowData(node.children, v, path, title);
    else if (node.kind === "repeatable") {
      out[node.key] = rowsOf(v).map((row, i) => ({
        ...newRowData(node.children, row, `${path}[${i}]`, title),
        [ROW_ID]: rowIdOf(row) ?? rowIdOf(newRow())!,
      }));
    } else {
      const coerced = validatedValue(node, path, title, v);

      if (coerced !== null) out[node.key] = coerced;
    }
  }

  return out;
}

/** Added rows answer the intake form in full: its required fields and validations apply. */
function assertRowsComplete(
  schema: RiskSchema,
  form: FormDefinition,
  risk: Record<string, unknown>,
  added: { repeat: string; index: number; title: string }[],
) {
  const { errors } = validateSubmission(schema, form, risk);

  const missing = added.flatMap(({ repeat, index, title }) => {
    const prefix = `${repeat}[${index}].`;

    return Object.entries(errors)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, messages]) => {
        const field = labelAt(schema, canonicalPath(path));

        return {
          path,
          message: `${title} · ${field ?? path.slice(prefix.length)}: ${messages[0]}`,
        };
      });
  });

  if (missing.length === 0) return;

  throw invalid(missing.map((m) => m.message).join("; "), {
    errors: Object.fromEntries(missing.map((m) => [m.path, [m.message]])),
  });
}

function labelAt(schema: RiskSchema, path: string): string | undefined {
  const walk = (nodes: SchemaNode[], base: string): string | undefined => {
    for (const node of nodes) {
      const p = joinPath(base, node.key);

      if (p === path) return node.label;

      if (node.kind === "group" && path.startsWith(`${p}.`)) return walk(node.children, p);

      if (node.kind === "repeatable" && path.startsWith(`${p}[]`))
        return walk(node.children, `${p}[]`);
    }

    return undefined;
  };

  return walk(schema.fields, "");
}

function endorsablePaths(nodes: SchemaNode[], base = ""): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    const path = joinPath(base, node.key);

    if (node.kind === "group" || node.kind === "repeatable") {
      const child = node.kind === "repeatable" ? `${path}[]` : path;

      const rowsChange =
        node.kind === "repeatable" && node.endorsable !== undefined && node.endorsable !== false;

      for (const p of rowsChange
        ? allPaths(node.children, child)
        : endorsablePaths(node.children, child)) {
        paths.add(p);
      }
    } else if (node.endorsable !== undefined && node.endorsable !== false) {
      paths.add(path);
    }
  }

  return paths;
}

function allPaths(nodes: SchemaNode[], base: string): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    const path = joinPath(base, node.key);

    if (node.kind === "group") for (const p of allPaths(node.children, path)) paths.add(p);
    else if (node.kind === "repeatable")
      for (const p of allPaths(node.children, `${path}[]`)) paths.add(p);
    else paths.add(path);
  }

  return paths;
}

/**
 * The release's endorsement form, or its quote form narrowed to what an endorsement can change.
 * A repeatable whose rows can be added keeps all its questions: new rows answer them in full.
 */
export function endorsementForm(
  schema: RiskSchema,
  forms: readonly { channel: string; stage: string; form: FormDefinition }[],
): FormDefinition | null {
  const own = forms.find((f) => f.stage === "endorsement");

  if (own) return own.form;

  const quote = intakeForm(forms);

  if (!quote) return null;

  const paths = endorsablePaths(schema.fields);

  const steps = quote.steps
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

  return steps.length > 0 ? { ...quote, key: `${quote.key}-endorsement`, steps } : null;
}

export const intakeForm = (
  forms: readonly { channel: string; stage: string; form: FormDefinition }[],
) =>
  (
    forms.find((f) => f.stage === "quote" && f.channel === "agent") ??
    forms.find((f) => f.stage === "quote")
  )?.form ?? null;

function validatedValue(field: FieldNode, path: string, label: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;

  const result = coerce(field, value);

  if (!result.ok) throw invalid(`${label}: ${result.message}`, { path });

  return result.value;
}

import { isRecord, newId } from "@pas/kernel";
import { ROW_ID, rowIdOf } from "./paths";
import type { SchemaNode, RiskSchema } from "./schema";

export const newRow = (): Record<string, unknown> => ({ [ROW_ID]: newId() });

/** Rows saved before row ids existed get one from their position, the same on every read. */
export const legacyRowId = (index: number) => `row-${index + 1}`;

/**
 * Gives every repeatable row a stable `$id`, keeping the ones it has. Returns `data` itself when
 * every row already has one.
 */
export function withRowIds<T>(
  schema: RiskSchema,
  data: T,
  makeId: (index: number) => string = () => newId(),
): T {
  const walk = (nodes: SchemaNode[], value: unknown): unknown => {
    if (!isRecord(value)) return value;

    let out: Record<string, unknown> | null = null;

    for (const node of nodes) {
      const current = value[node.key];
      let next = current;

      if (node.kind === "group") next = walk(node.children, current);
      else if (node.kind === "repeatable" && Array.isArray(current)) {
        next = rowsWithIds(current, (row) => walk(node.children, row), makeId);
      }

      if (next !== current) {
        out ??= { ...value };
        out[node.key] = next;
      }
    }

    return out ?? value;
  };

  return walk(schema.fields, data) as T;
}

function rowsWithIds(
  rows: unknown[],
  inner: (row: unknown) => unknown,
  makeId: (index: number) => string,
): unknown[] {
  const taken = new Set<string>();
  let changed = false;

  const next = rows.map((row, index) => {
    const own = rowIdOf(row);
    let id = own && !taken.has(own) ? own : makeId(index);

    while (taken.has(id)) id = `${id}-${index + 1}`;

    taken.add(id);

    const walked = inner(row);
    const base = isRecord(walked) ? walked : {};

    if (id === own && walked === row) return row;

    changed = true;

    return { ...base, [ROW_ID]: id };
  });

  return changed ? next : rows;
}

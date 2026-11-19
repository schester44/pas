import { isRecord } from "@pas/kernel";

/** A repeatable row addressed by its stable `$id` rather than its position: `locations[#…]`. */
export interface RowRef {
  id: string;
}

export type Segment = string | number | RowRef;

export const ROW_ID = "$id";

const BRACKET = /\[(\d*|#[^\]]+)\]/g;

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];

  for (const part of path.split(".")) {
    const match = /^([^[\]]*)((?:\[(?:\d*|#[^\]]+)\])*)$/.exec(part);

    if (!match) throw new Error(`Invalid path: ${path}`);

    if (match[1]) segments.push(match[1]);

    for (const [, inner] of match[2]!.matchAll(BRACKET)) {
      segments.push(inner!.startsWith("#") ? { id: inner!.slice(1) } : Number(inner));
    }
  }

  return segments;
}

export function joinPath(base: string, child: string): string {
  if (!base) return child;

  return child.startsWith("[") ? `${base}${child}` : `${base}.${child}`;
}

export const rowPath = (repeat: string, id: string) => `${repeat}[#${id}]`;

export function canonicalPath(path: string): string {
  return path.replace(BRACKET, "[]");
}

export const rowIdOf = (row: unknown): string | undefined =>
  isRecord(row) && typeof row[ROW_ID] === "string" ? row[ROW_ID] : undefined;

const indexOf = (list: unknown[], segment: number | RowRef) =>
  typeof segment === "number" ? segment : list.findIndex((row) => rowIdOf(row) === segment.id);

export function getAt(data: unknown, path: string): unknown {
  let current: unknown = data;

  for (const segment of parsePath(path)) {
    if (typeof segment === "string") {
      if (!isRecord(current)) return undefined;

      current = current[segment];
    } else {
      if (!Array.isArray(current)) return undefined;

      const at = indexOf(current, segment);

      current = at < 0 ? undefined : current[at];
    }
  }

  return current;
}

/** Writes `value` at `path`; a path through a row id that isn't there leaves the data as is. */
export function setAt<T>(data: T, path: string, value: unknown): T {
  const segments = parsePath(path);
  const missing = Symbol("missing");

  const write = (current: unknown, depth: number): unknown => {
    const segment = segments[depth]!;
    const last = depth === segments.length - 1;

    if (typeof segment !== "string") {
      const list = Array.isArray(current) ? [...current] : [];
      const at = indexOf(list, segment);

      if (at < 0) return missing;

      const next = last ? value : write(list[at], depth + 1);

      if (next === missing) return missing;

      list[at] = next;

      for (let i = 0; i < list.length; i++) if (list[i] === undefined) list[i] = {};

      return list;
    }

    const record = isRecord(current) ? { ...current } : {};
    const next = last ? value : write(record[segment], depth + 1);

    if (next === missing) return missing;

    if (next === undefined) delete record[segment];
    else record[segment] = next;

    return record;
  };

  const written = write(data, 0);

  return (written === missing ? data : written) as T;
}

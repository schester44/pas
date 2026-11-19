import { isRecord } from "@pas/kernel";
export type Segment = string | number;

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];

  for (const part of path.split(".")) {
    const match = /^([^[\]]*)((?:\[\d*\])*)$/.exec(part);

    if (!match) throw new Error(`Invalid path: ${path}`);

    if (match[1]) segments.push(match[1]);

    for (const index of match[2]!.matchAll(/\[(\d*)\]/g)) segments.push(Number(index[1]));
  }

  return segments;
}

export function joinPath(base: string, child: string): string {
  if (!base) return child;

  return child.startsWith("[") ? `${base}${child}` : `${base}.${child}`;
}

export function canonicalPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

export function getAt(data: unknown, path: string): unknown {
  let current: unknown = data;

  for (const segment of parsePath(path)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;

      current = current[segment];
    } else {
      if (!isRecord(current)) return undefined;

      current = current[segment];
    }
  }

  return current;
}

export function setAt<T>(data: T, path: string, value: unknown): T {
  const segments = parsePath(path);

  const write = (current: unknown, depth: number): unknown => {
    const segment = segments[depth]!;
    const last = depth === segments.length - 1;

    if (typeof segment === "number") {
      const list = Array.isArray(current) ? [...current] : [];
      list[segment] = last ? value : write(list[segment], depth + 1);

      for (let i = 0; i < list.length; i++) if (list[i] === undefined) list[i] = {};

      return list;
    }

    const record = isRecord(current) ? { ...current } : {};
    const next = last ? value : write(record[segment], depth + 1);

    if (next === undefined) delete record[segment];
    else record[segment] = next;

    return record;
  };

  return write(data, 0) as T;
}

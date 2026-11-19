import { parseInstant } from "@pas/kernel";

/** Revives ISO timestamps stored in JSON at the given keys. */
export function revive<T>(value: unknown, keys: readonly string[]): T {
  const record = value as Record<string, unknown>;

  return {
    ...record,
    ...Object.fromEntries(
      keys
        .filter((k) => typeof record[k] === "string")
        .map((k) => [k, parseInstant(record[k] as string)]),
    ),
  } as T;
}

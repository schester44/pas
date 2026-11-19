import type { Prisma } from "@pas/db/client";

export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const toDb = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
export const fromDb = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
export const dateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
export const dateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
export const instant = (value: string) => Temporal.Instant.from(value);

/** Revives ISO timestamps stored in JSON at the given keys. */
export function revive<T>(value: unknown, keys: readonly string[]): T {
  const record = value as Record<string, unknown>;

  return {
    ...record,
    ...Object.fromEntries(
      keys
        .filter((k) => typeof record[k] === "string")
        .map((k) => [k, instant(record[k] as string)]),
    ),
  } as T;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A plain-data deep copy: drops undefined, turns Money/Temporal values into their JSON form. */
export const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

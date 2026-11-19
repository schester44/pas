function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);

  if (value === null || typeof value !== "object") return value === "" ? undefined : value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([k, v]) => [k, clean(v)] as const)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b)),
  );
}

/** Equal as data: key order, empty strings and missing optional fields don't count. */
export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(clean(a) ?? null) === JSON.stringify(clean(b) ?? null);

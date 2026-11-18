/** Deterministic JSON: object keys sorted, undefined members dropped. Used for content hashes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value === null || typeof value !== "object") return value;

  if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return sortKeys((value as { toJSON: () => unknown }).toJSON());
  }

  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .toSorted()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

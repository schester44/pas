const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Reads the canonical `insured` group (PLAN §10.1) until schemas can tag a display-name field. */
export function insuredNameOf(data: Record<string, unknown>): string | null {
  const insured = data.insured;

  if (!isRecord(insured)) return null;

  const name =
    text(insured.name) ||
    text(insured.businessName) ||
    [text(insured.firstName), text(insured.lastName)].filter(Boolean).join(" ");

  return name || null;
}

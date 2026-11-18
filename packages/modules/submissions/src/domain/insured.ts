import { type AddressValue, getAt } from "@pas/forms-core";

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

const isAddress = (value: unknown): value is AddressValue =>
  isRecord(value) && typeof value.line1 === "string";

/** The canonical `mailingAddress` field, when the schema captures one. */
export function mailingAddressOf(data: Record<string, unknown>): AddressValue | null {
  return isAddress(data.mailingAddress) ? data.mailingAddress : null;
}

/** A readable name for one exposure entry, such as a location's street address. */
export function exposureLabel(data: Record<string, unknown>, exposure: string): string {
  const match = /^(.*)\[(\d+)\]$/.exec(exposure);

  if (!match) return exposure;

  const entries = getAt(data, match[1]!);
  const index = Number(match[2]);
  const entry = Array.isArray(entries) ? entries[index] : undefined;
  const address = isRecord(entry) ? Object.values(entry).find(isAddress) : undefined;

  return address ? [address.line1, address.city].filter(Boolean).join(", ") : `#${index + 1}`;
}

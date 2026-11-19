import {
  type AddressValue,
  getAt,
  joinPath,
  type RiskSchema,
  type SchemaNode,
} from "@pas/forms-core";
import type { UsageRole } from "./clearance";

interface AddressField {
  /** Canonical path, with `[]` for each repeatable on the way. */
  path: string;
  role: UsageRole;
}

/** Address fields inside an exposure (a location, a building) are risk locations; others mail. */
export function addressFieldsOf(schema: RiskSchema): AddressField[] {
  const found: AddressField[] = [];

  const walk = (nodes: readonly SchemaNode[], prefix: string, exposure: boolean) => {
    for (const node of nodes) {
      const path = prefix ? `${prefix}.${node.key}` : node.key;

      if (node.kind === "group") walk(node.children, path, exposure || Boolean(node.exposure));
      else if (node.kind === "repeatable")
        walk(node.children, `${path}[]`, exposure || Boolean(node.exposure));
      else if (node.kind === "address")
        found.push({ path, role: exposure ? "location" : "mailing" });
    }
  };

  walk(schema.fields, "", false);

  return found;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isAddressValue = (value: unknown): value is AddressValue =>
  isRecord(value) && typeof value.line1 === "string" && typeof value.city === "string";

/** Every filled address in the data with its concrete path (`locations[1].address`). */
export function addressesIn(
  schema: RiskSchema,
  data: Readonly<Record<string, unknown>>,
): { path: string; role: UsageRole; value: AddressValue }[] {
  const expand = (pattern: string): string[] => {
    const at = pattern.indexOf("[]");

    if (at < 0) return [pattern];

    const base = pattern.slice(0, at);
    const rest = pattern.slice(at + 2).replace(/^\./, "");
    const rows = getAt(data, base);

    if (!Array.isArray(rows)) return [];

    return rows.flatMap((_, i) =>
      expand(rest ? joinPath(joinPath(base, `[${i}]`), rest) : joinPath(base, `[${i}]`)),
    );
  };

  return addressFieldsOf(schema).flatMap(({ path, role }) =>
    expand(path).flatMap((concrete) => {
      const value = getAt(data, concrete);

      return isAddressValue(value) && value.line1.trim() ? [{ path: concrete, role, value }] : [];
    }),
  );
}

/** The registry ids already stamped anywhere in a document (risk data, bind details). */
export function addressIdsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(addressIdsIn);

  if (!isRecord(value)) return [];

  const own = isAddressValue(value) && typeof value.addressId === "string" ? [value.addressId] : [];

  return [...own, ...Object.values(value).flatMap(addressIdsIn)];
}

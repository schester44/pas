import type { AddressComponents, AddressInput, Verification } from "./address";
import { displayCase, splitUnit, standardStreet } from "./normalize";

const UNIT_WORDS: Record<string, string> = {
  APARTMENT: "APT",
  SUITE: "STE",
  NUMBER: "#",
  NO: "#",
  FLOOR: "FL",
  BUILDING: "BLDG",
  ROOM: "RM",
  SPACE: "SPC",
  BASEMENT: "BSMT",
  PENTHOUSE: "PH",
};

/** "Apartment 4b" is "APT 4B", "#4b" is "# 4B". */
export function standardUnit(unit: string): { line: string; designator?: string; number?: string } {
  const words = unit
    .toUpperCase()
    .replace(/#/g, " # ")
    .replace(/[^A-Z0-9#\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return { line: "" };

  const [first, ...rest] = words;
  const designator = UNIT_WORDS[first!] ?? first!;
  const isDesignator = /^[A-Z#]+$/.test(first!) && (rest.length > 0 || !/\d/.test(first!));

  if (!isDesignator)
    return { line: `# ${words.join("")}`, designator: "#", number: words.join("") };

  const number = rest.filter((word) => word !== "#").join("") || undefined;

  return {
    line: [designator, number].filter(Boolean).join(" "),
    designator,
    ...(number && { number }),
  };
}

/**
 * Normalizes an address without any provider: USPS-style casing and abbreviations, the unit split
 * out. It is never "verified"; it only keeps formatting differences from creating new records.
 */
export function standardizeOffline(input: AddressInput, provider = "offline"): Verification {
  const split = splitUnit(input.line1);
  const unit = standardUnit(input.line2?.trim() ? input.line2 : split.unit);
  const line1 = standardStreet(split.street);
  const primary = /^\d+[A-Z]?$/.test(line1.split(" ")[0] ?? "") ? line1.split(" ")[0] : undefined;
  const digits = input.postalCode.replace(/\D/g, "");

  const components: AddressComponents = {
    ...(primary && { primaryNumber: primary }),
    ...(primary && { streetName: line1.slice(primary.length).trim() }),
    ...(unit.designator && { secondaryDesignator: unit.designator }),
    ...(unit.number && { secondaryNumber: unit.number }),
  };

  return {
    status: "unverified",
    provider,
    providerAddressId: null,
    address: {
      line1: displayCase(line1),
      ...(unit.line && { line2: displayCase(unit.line) }),
      city: displayCase(input.city),
      region: input.region.trim().toUpperCase(),
      postalCode: digits.slice(0, 5) || input.postalCode.trim(),
      ...(digits.length === 9 && { plus4: digits.slice(5) }),
      country: input.country.trim().toUpperCase() || "US",
      components,
    },
    dpv: { match: null, vacant: null, deliverable: null },
    geocode: null,
    notes: [],
  };
}

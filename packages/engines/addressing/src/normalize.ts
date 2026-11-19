import type { AddressInput, StandardizedAddress, Verification } from "./address";

const SUFFIXES: Record<string, string> = {
  ALLEY: "ALY",
  AVENUE: "AVE",
  AV: "AVE",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  COURT: "CT",
  COVE: "CV",
  CROSSING: "XING",
  DRIVE: "DR",
  EXPRESSWAY: "EXPY",
  HIGHWAY: "HWY",
  LANE: "LN",
  PARKWAY: "PKWY",
  PLACE: "PL",
  PLAZA: "PLZ",
  POINT: "PT",
  ROAD: "RD",
  ROUTE: "RTE",
  SQUARE: "SQ",
  STREET: "ST",
  STR: "ST",
  TERRACE: "TER",
  TRAIL: "TRL",
  TURNPIKE: "TPKE",
  WAY: "WAY",
};

const DIRECTIONS: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

/** Designators that name the same kind of unit, so "Apt 2B", "Unit 2-b" and "#2B" are one unit. */
const SAME_UNIT = new Set(["APT", "APARTMENT", "UNIT", "STE", "SUITE", "#", "NO", "NUMBER"]);

const OTHER_UNITS: Record<string, string> = {
  FL: "FL",
  FLOOR: "FL",
  BLDG: "BLDG",
  BUILDING: "BLDG",
  LOT: "LOT",
  SPC: "SPC",
  SPACE: "SPC",
  RM: "RM",
  ROOM: "RM",
  DEPT: "DEPT",
  TRLR: "TRLR",
  PH: "PH",
  PENTHOUSE: "PH",
};

const BARE_UNITS: Record<string, string> = {
  BSMT: "BSMT",
  BASEMENT: "BSMT",
  REAR: "REAR",
  FRNT: "FRNT",
  FRONT: "FRNT",
  LOWR: "LOWR",
  LOWER: "LOWR",
  UPPR: "UPPR",
  UPPER: "UPPR",
  SIDE: "SIDE",
  OFC: "OFC",
  OFFICE: "OFC",
  LBBY: "LBBY",
  LOBBY: "LBBY",
};

const clean = (word: string | undefined) => (word ?? "").toUpperCase().replace(/[.,]/g, "");

const looksLikeUnitId = (word: string | undefined) =>
  word !== undefined && (/\d/.test(word) || clean(word).length <= 2);

// "12 Front St" and "9 Lot Ave" are streets, not units: a designator needs an id after it.
function startsUnit(parts: readonly string[], i: number): boolean {
  const word = clean(parts[i]);

  if (word.startsWith("#")) return true;

  if (SAME_UNIT.has(word) || OTHER_UNITS[word]) return looksLikeUnitId(parts[i + 1]);

  return Boolean(BARE_UNITS[word]) && i === parts.length - 1;
}

const tokens = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/#/g, " # ")
    .replace(/[^A-Z0-9#\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The canonical unit: "Apt 2B", "unit 2-b" and "#2b" are all "2B"; "Floor 3" is "FL 3". */
export function normalizeUnit(value: string | undefined): string {
  const parts = tokens(value ?? "").filter((part) => part !== "-");

  if (parts.length === 0) return "";

  const [first, ...rest] = parts;

  const id = rest
    .filter((part) => part !== "#")
    .join("")
    .replaceAll("-", "");

  if (first && SAME_UNIT.has(first)) return id;

  if (first && OTHER_UNITS[first]) return id ? `${OTHER_UNITS[first]} ${id}` : OTHER_UNITS[first];

  if (first && BARE_UNITS[first] && !id) return BARE_UNITS[first];

  return parts.join("").replaceAll("-", "");
}

/** Splits a trailing unit off a street line: "12 Elm St Apt 4" is "12 Elm St" and "Apt 4". */
export function splitUnit(line: string): { street: string; unit: string } {
  const parts = line.trim().split(/\s+/);

  for (let i = 1; i < parts.length; i++) {
    if (startsUnit(parts, i)) {
      return {
        street: parts.slice(0, i).join(" ").replace(/,$/, ""),
        unit: parts.slice(i).join(" "),
      };
    }
  }

  return { street: line.trim(), unit: "" };
}

/** Uppercase with USPS street suffix and directional abbreviations. */
export function standardStreet(line: string): string {
  const words = tokens(line).filter((word) => word !== "#" && word !== "-");

  return words
    .map((word, index) => {
      const direction = DIRECTIONS[word];

      if (direction) return direction;

      return index > 0 && SUFFIXES[word] ? SUFFIXES[word] : word;
    })
    .join(" ");
}

const zip5 = (postalCode: string) => postalCode.replace(/\D/g, "").slice(0, 5);

/**
 * A provider-independent key from the address text, so the same address typed differently lands
 * on one record even when no provider could verify it.
 */
export function textKey(
  address: Pick<AddressInput, "line1" | "line2" | "city" | "region" | "postalCode" | "country">,
): string {
  const split = splitUnit(address.line1);
  const unit = normalizeUnit(address.line2?.trim() ? address.line2 : split.unit);
  const zip = zip5(address.postalCode);
  const place = zip || `${standardStreet(address.city)} ${standardStreet(address.region)}`;

  return `text:${address.country.toUpperCase()}:${place}:${standardStreet(split.street)}#${unit}`;
}

export function unitOf(address: Pick<StandardizedAddress, "line2" | "components">): string {
  const { secondaryDesignator, secondaryNumber } = address.components;

  if (secondaryDesignator || secondaryNumber) {
    return normalizeUnit([secondaryDesignator ?? "#", secondaryNumber].filter(Boolean).join(" "));
  }

  return normalizeUnit(address.line2);
}

/**
 * The registry key (vendors.md §1.4): provider address id plus unit, because SmartyKey is unique
 * per delivery point rather than per unit. Unverified addresses fall back to the text key.
 */
export function registryKey(verification: Verification): string {
  if (verification.status === "verified" && verification.providerAddressId) {
    return `${verification.provider}:${verification.providerAddressId}#${unitOf(verification.address)}`;
  }

  return textKey(verification.address);
}

const UPPER_WORDS = new Set([...Object.values(DIRECTIONS), "PO", "US", "#"]);

/** "1420 ELMWOOD AVE" reads as "1420 Elmwood Ave", the way verification APIs return it. */
export function displayCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (UPPER_WORDS.has(word.toUpperCase())) return word.toUpperCase();

      if (/^\d/.test(word))
        return word.toLowerCase().replace(/^(\d+)([a-z])$/, (_, d, l) => `${d}${l.toUpperCase()}`);

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function formatAddress(
  address: Pick<AddressInput, "line1" | "line2" | "city" | "region" | "postalCode">,
): string {
  const street = [address.line1, address.line2].filter((part) => part?.trim()).join(" ");

  return `${street}, ${address.city}, ${address.region} ${address.postalCode}`.trim();
}

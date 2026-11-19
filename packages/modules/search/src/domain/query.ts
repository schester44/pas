export const SEARCH_TYPES = [
  "client",
  "policy",
  "submission",
  "invoice",
  "product",
  "member",
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export type SearchQuery =
  | { kind: "number"; prefix: string; digits: string; types: readonly SearchType[] }
  | { kind: "digits"; digits: string; types: readonly SearchType[] }
  | { kind: "text"; text: string; types: readonly SearchType[] }
  | { kind: "ids"; ids: readonly string[]; types: readonly SearchType[] };

const MAX_LENGTH = 100;

const NUMBER_PREFIXES: Record<string, readonly SearchType[]> = {
  POL: ["policy", "invoice"],
  SUB: ["submission"],
  INV: ["invoice"],
};

const NUMBERED: readonly SearchType[] = ["policy", "submission", "invoice", "client"];

/** Decides how a palette query is matched: by document number, by digits, or as free text. */
export function classifyQuery(raw: string): SearchQuery | null {
  const q = raw.trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH);

  if (q.length === 0) return null;

  const numbered = /^([a-z]{3})(?:-\s?|\s?(?=\d))(\d*)$/i.exec(q);
  const types = numbered && NUMBER_PREFIXES[numbered[1]!.toUpperCase()];

  if (numbered && types) {
    return { kind: "number", prefix: numbered[1]!.toUpperCase(), digits: numbered[2]!, types };
  }

  if (/^[\d\s()+.-]+$/.test(q)) {
    const digits = q.replace(/\D/g, "");

    if (digits.length > 0) return { kind: "digits", digits, types: NUMBERED };
  }

  if (q.length < 2) return null;

  return { kind: "text", text: q, types: SEARCH_TYPES };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

import { invalid } from "./errors";

/** ISO 3166-1 alpha-2 country plus an optional ISO 3166-2 subdivision (e.g. US + US-IL). */
export interface Jurisdiction {
  readonly country: string;
  readonly subdivision?: string;
}

const COUNTRY = /^[A-Z]{2}$/;
const SUBDIVISION = /^([A-Z]{2})-[A-Z0-9]{1,3}$/;

export function jurisdiction(country: string, subdivision?: string | null): Jurisdiction {
  const c = country.trim().toUpperCase();

  if (!COUNTRY.test(c)) throw invalid(`${country} isn't an ISO 3166-1 country code`, { country });

  const s = subdivision?.trim().toUpperCase();

  if (!s) return { country: c };

  const match = SUBDIVISION.exec(s);

  if (!match) throw invalid(`${subdivision} isn't an ISO 3166-2 subdivision code`, { subdivision });

  if (match[1] !== c) throw invalid(`${s} isn't in ${c}`, { country: c, subdivision: s });

  return { country: c, subdivision: s };
}

export function jurisdictionCode(j: Jurisdiction): string {
  return j.subdivision ?? j.country;
}

export function sameJurisdiction(a: Jurisdiction, b: Jurisdiction): boolean {
  return a.country === b.country && (a.subdivision ?? null) === (b.subdivision ?? null);
}

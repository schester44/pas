import type { Jurisdiction } from "./context";
import type { Clause } from "./model";

export interface ResolvedClause {
  title: string;
  body: string;
  variant: number | null;
}

/** The subdivision's variant wins over a country-wide one; otherwise the default wording. */
export function resolveClause(clause: Clause, jurisdiction: Jurisdiction): ResolvedClause {
  const pick = (code: string) =>
    clause.variants.findIndex((variant) => variant.jurisdictions.includes(code));

  const exact = jurisdiction.subdivision ? pick(jurisdiction.subdivision) : -1;
  const index = exact >= 0 ? exact : pick(jurisdiction.country);
  const variant = clause.variants[index];

  if (!variant) return { title: clause.title, body: clause.body, variant: null };

  return { title: variant.title || clause.title, body: variant.body, variant: index };
}

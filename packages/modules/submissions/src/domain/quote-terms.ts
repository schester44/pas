import { isRecord } from "@pas/kernel";
export interface QuoteTerms {
  validityDays: number;
  referralReviewHours: number;
  termMonths: number;
}

const FALLBACK: QuoteTerms = { validityDays: 30, referralReviewHours: 24, termMonths: 12 };

const positive = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;

/** Validity, review window and term length from the release's `lifecycle` (PLAN §7, parameters). */
export function quoteTermsFrom(lifecycle: Record<string, unknown>): QuoteTerms {
  const quote = isRecord(lifecycle.quote) ? lifecycle.quote : {};
  const term = isRecord(lifecycle.term) ? lifecycle.term : {};

  return {
    validityDays: positive(quote.validityDays, FALLBACK.validityDays),
    referralReviewHours: positive(quote.referralReviewHours, FALLBACK.referralReviewHours),
    termMonths: positive(term.months, FALLBACK.termMonths),
  };
}

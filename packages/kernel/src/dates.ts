/**
 * Effective dates are calendar dates (Temporal.PlainDate) interpreted in the risk's
 * jurisdiction. Recorded times are Temporal.Instant. Never use `Date` in domain code.
 */
export type PlainDate = Temporal.PlainDate;
export type Instant = Temporal.Instant;

export function parsePlainDate(value: string): PlainDate {
  return Temporal.PlainDate.from(value);
}

export function parseInstant(value: string): Instant {
  return Temporal.Instant.from(value);
}

/** Half-open range [start, end). Policy terms run from effective date to expiration date. */
export interface DateRange {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

export function daysInRange(range: DateRange): number {
  return range.start.until(range.end, { largestUnit: "days" }).days;
}

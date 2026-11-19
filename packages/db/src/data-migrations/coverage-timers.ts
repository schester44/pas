import {
  coverageInstant,
  type Instant,
  type Jurisdiction,
  jurisdictionTimeZone,
  type PlainDate,
} from "@pas/kernel";

// Old waits were set with whole-second rounding plus insert latency, so they land just after midnight.
const DRIFT_MS = 5 * 60 * 1000;

/**
 * Coverage timers created before jurisdiction time woke at UTC midnight of the date. Returns the
 * 12:01 a.m. local standard time wake instead, or null when the wait isn't one of those.
 */
export function coverageWake(
  wakeAt: Instant,
  date: PlainDate,
  jurisdiction: Jurisdiction,
): Instant | null {
  const midnight = date.toZonedDateTime("UTC").toInstant();
  const drift = wakeAt.epochMilliseconds - midnight.epochMilliseconds;

  if (drift < 0 || drift >= DRIFT_MS) return null;

  const target = coverageInstant(date, jurisdictionTimeZone(jurisdiction));

  return target.equals(midnight) ? null : target;
}

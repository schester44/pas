import type { Instant, PlainDate } from "./dates";
import type { Jurisdiction } from "./jurisdiction";

// Predominant IANA zone per subdivision; states split across zones use the zone most of the population is in.
const SUBDIVISION_ZONES: Record<string, string> = {
  "US-AL": "America/Chicago",
  "US-AK": "America/Anchorage",
  "US-AZ": "America/Phoenix",
  "US-AR": "America/Chicago",
  "US-CA": "America/Los_Angeles",
  "US-CO": "America/Denver",
  "US-CT": "America/New_York",
  "US-DE": "America/New_York",
  "US-DC": "America/New_York",
  "US-FL": "America/New_York",
  "US-GA": "America/New_York",
  "US-HI": "Pacific/Honolulu",
  "US-ID": "America/Boise",
  "US-IL": "America/Chicago",
  "US-IN": "America/Indiana/Indianapolis",
  "US-IA": "America/Chicago",
  "US-KS": "America/Chicago",
  "US-KY": "America/New_York",
  "US-LA": "America/Chicago",
  "US-ME": "America/New_York",
  "US-MD": "America/New_York",
  "US-MA": "America/New_York",
  "US-MI": "America/Detroit",
  "US-MN": "America/Chicago",
  "US-MS": "America/Chicago",
  "US-MO": "America/Chicago",
  "US-MT": "America/Denver",
  "US-NE": "America/Chicago",
  "US-NV": "America/Los_Angeles",
  "US-NH": "America/New_York",
  "US-NJ": "America/New_York",
  "US-NM": "America/Denver",
  "US-NY": "America/New_York",
  "US-NC": "America/New_York",
  "US-ND": "America/Chicago",
  "US-OH": "America/New_York",
  "US-OK": "America/Chicago",
  "US-OR": "America/Los_Angeles",
  "US-PA": "America/New_York",
  "US-RI": "America/New_York",
  "US-SC": "America/New_York",
  "US-SD": "America/Chicago",
  "US-TN": "America/Chicago",
  "US-TX": "America/Chicago",
  "US-UT": "America/Denver",
  "US-VT": "America/New_York",
  "US-VA": "America/New_York",
  "US-WA": "America/Los_Angeles",
  "US-WV": "America/New_York",
  "US-WI": "America/Chicago",
  "US-WY": "America/Denver",
  "US-PR": "America/Puerto_Rico",
  "US-GU": "Pacific/Guam",
  "US-VI": "America/St_Thomas",
};

const COUNTRY_ZONES: Record<string, string> = {
  GB: "Europe/London",
  IE: "Europe/Dublin",
};

export function jurisdictionTimeZone(j: Jurisdiction): string {
  return (j.subdivision && SUBDIVISION_ZONES[j.subdivision]) || COUNTRY_ZONES[j.country] || "UTC";
}

/** Coverage dates turn at 12:01 a.m. local standard time, so daylight saving never shifts them. */
export function coverageInstant(date: PlainDate, timeZone: string): Instant {
  const offset = (month: number) =>
    Temporal.PlainDate.from({ year: date.year, month, day: 1 }).toZonedDateTime({ timeZone })
      .offsetNanoseconds;

  const standardOffsetNs = Math.min(offset(1), offset(7));

  return date
    .toPlainDateTime({ hour: 0, minute: 1 })
    .toZonedDateTime("UTC")
    .toInstant()
    .subtract({ nanoseconds: standardOffsetNs });
}

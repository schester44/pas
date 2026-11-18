import { describe, expect, it } from "vitest";
import { jurisdiction } from "./jurisdiction";
import { coverageInstant, jurisdictionTimeZone } from "./jurisdiction-time";

const at = (date: string, j = jurisdiction("US", "US-FL")) =>
  coverageInstant(Temporal.PlainDate.from(date), jurisdictionTimeZone(j)).toString();

describe("coverageInstant", () => {
  it("turns at 12:01 a.m. local standard time, ignoring daylight saving", () => {
    expect(at("2027-01-15")).toBe("2027-01-15T05:01:00Z");
    expect(at("2027-07-15")).toBe("2027-07-15T05:01:00Z");
    expect(at("2027-07-15", jurisdiction("US", "US-CA"))).toBe("2027-07-15T08:01:00Z");
    expect(at("2027-07-15", jurisdiction("US", "US-AZ"))).toBe("2027-07-15T07:01:00Z");
  });

  it("falls back to UTC for jurisdictions without a known zone", () => {
    expect(at("2027-03-01", jurisdiction("ZZ"))).toBe("2027-03-01T00:01:00Z");
  });
});

import { jurisdiction } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { coverageWake } from "./coverage-timers";

const date = Temporal.PlainDate.from("2027-08-01");
const illinois = jurisdiction("US", "US-IL");

describe("coverageWake", () => {
  it("moves a UTC-midnight wait to 12:01 a.m. local standard time", () => {
    const wake = coverageWake(Temporal.Instant.from("2027-08-01T00:00:00.812Z"), date, illinois);

    expect(wake?.toString()).toBe("2027-08-01T06:01:00Z");
  });

  it("uses standard time in winter too", () => {
    const winter = Temporal.PlainDate.from("2028-01-15");
    const wake = coverageWake(Temporal.Instant.from("2028-01-15T00:00:01Z"), winter, illinois);

    expect(wake?.toString()).toBe("2028-01-15T06:01:00Z");
  });

  it("leaves waits that already target local time, or another date, alone", () => {
    expect(
      coverageWake(Temporal.Instant.from("2027-08-01T06:01:00.2Z"), date, illinois),
    ).toBeNull();

    expect(coverageWake(Temporal.Instant.from("2027-07-31T23:59:59Z"), date, illinois)).toBeNull();
    expect(coverageWake(Temporal.Instant.from("2027-08-02T00:00:00Z"), date, illinois)).toBeNull();
  });

  it("moves UTC jurisdictions to 12:01 a.m. UTC", () => {
    const wake = coverageWake(
      Temporal.Instant.from("2027-08-01T00:00:00.5Z"),
      date,
      jurisdiction("ZZ"),
    );

    expect(wake?.toString()).toBe("2027-08-01T00:01:00Z");
  });
});

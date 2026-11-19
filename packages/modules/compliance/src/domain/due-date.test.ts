import { describe, expect, it } from "vitest";
import { addBusinessDays, dueDate, lateFrom, reportingPeriod } from "./due-date";

const d = (value: string) => Temporal.PlainDate.from(value);

const rule = (overrides: Partial<Parameters<typeof dueDate>[0]> = {}) => ({
  days: 10,
  from: "effective" as const,
  businessDays: false,
  holidays: [],
  ...overrides,
});

describe("obligation due dates", () => {
  it("counts calendar days from the effective date", () => {
    expect(
      dueDate(rule({ days: 90 }), {
        effective: d("2027-12-01"),
        issued: d("2027-11-20"),
      }).toString(),
    ).toBe("2028-02-29");
  });

  it("counts from the later of the effective and issue dates", () => {
    const later = rule({ days: 30, from: "later_of_effective_issue" });

    expect(dueDate(later, { effective: d("2027-12-01"), issued: d("2027-11-20") }).toString()).toBe(
      "2027-12-31",
    );

    expect(dueDate(later, { effective: d("2027-12-01"), issued: d("2027-12-15") }).toString()).toBe(
      "2028-01-14",
    );
  });

  it("skips weekends and listed holidays when counting business days", () => {
    // Fri Dec 3 2027 + 5 business days skips the weekend and the Dec 8 holiday.
    expect(addBusinessDays(d("2027-12-03"), 5, ["2027-12-08"]).toString()).toBe("2027-12-13");

    expect(
      dueDate(rule({ days: 1, businessDays: true }), { effective: d("2027-12-03") }).toString(),
    ).toBe("2027-12-06");
  });

  it("rolls a zero-day business rule off a weekend", () => {
    expect(addBusinessDays(d("2027-12-04"), 0, []).toString()).toBe("2027-12-06");
  });

  it("is late from local midnight after the due date", () => {
    expect(lateFrom(d("2028-02-29"), "America/Chicago").toString()).toBe("2028-03-01T06:00:00Z");
  });

  it("dates periodic reports from the end of the period", () => {
    const half = reportingPeriod(d("2027-12-15"), "semiannual");

    expect([half.start.toString(), half.end.toString()]).toEqual(["2027-07-01", "2027-12-31"]);

    expect(
      dueDate(rule({ days: 32, from: "period_end" }), { periodEnd: half.end }).toString(),
    ).toBe("2028-02-01");

    expect(reportingPeriod(d("2028-05-02"), "quarterly").end.toString()).toBe("2028-06-30");
  });
});

import { describe, expect, it } from "vitest";
import { nextBatchDate, statementPeriods } from "./schedule";

const schedule = { batchTime: "02:00", timeZone: "America/Chicago" };
const date = (value: string) => Temporal.PlainDate.from(value);
const at = (value: string) => Temporal.Instant.from(value);

describe("batch schedule", () => {
  it("wakes nightly while items wait, monthly for statements otherwise, and catches up after time travel", () => {
    const now = at("2027-03-10T12:00:00Z");
    const base = { now, schedule, statements: true };

    expect(nextBatchDate({ ...base, after: null, pending: true })?.toString()).toBe("2027-03-11");
    expect(nextBatchDate({ ...base, after: null, pending: false })?.toString()).toBe("2027-04-01");
    expect(nextBatchDate({ ...base, after: null, pending: false, statements: false })).toBeNull();

    expect(nextBatchDate({ ...base, after: date("2027-01-15"), pending: true })?.toString()).toBe(
      "2027-03-10",
    );
  });

  it("sends a statement for every month a catch-up batch passed", () => {
    expect(
      statementPeriods(date("2026-12-16"), date("2027-03-02")).map((p) => [
        p.from.toString(),
        p.to.toString(),
      ]),
    ).toEqual([
      ["2026-12-01", "2026-12-31"],
      ["2027-01-01", "2027-01-31"],
      ["2027-02-01", "2027-02-28"],
    ]);

    expect(statementPeriods(date("2027-03-02"), date("2027-03-02"))).toEqual([]);
  });
});

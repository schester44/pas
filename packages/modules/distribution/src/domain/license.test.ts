import { describe, expect, it } from "vitest";
import { checkLicense } from "./license";

const date = Temporal.PlainDate.from;

const illinois = {
  subdivision: "US-IL",
  licenseNumber: "IL-1",
  linesOfAuthority: ["Property", "Casualty"],
  effectiveDate: date("2025-01-01"),
  expirationDate: date("2027-01-31"),
  status: "active" as const,
};

const check = (on: string, lines = ["property"], subdivision = "US-IL") =>
  checkLicense([illinois], {
    subdivision,
    linesOfAuthority: lines,
    on: date(on),
    place: "Illinois",
  });

describe("checkLicense", () => {
  it("passes with an in-force license in the state carrying a required line", () => {
    expect(check("2026-06-01")).toEqual({ ok: true, licenseNumber: "IL-1" });
  });

  it("fails in a state with no license", () => {
    expect(check("2026-06-01", ["property"], "US-IN")).toMatchObject({
      ok: false,
      reason: "no_license",
    });
  });

  it("fails without a matching line of authority", () => {
    expect(check("2026-06-01", ["Life", "Health"])).toMatchObject({
      ok: false,
      reason: "line_missing",
      message: "isn't licensed for Life or Health in Illinois",
    });
  });

  it("is valid through the expiration date and fails the day after", () => {
    expect(check("2027-01-31").ok).toBe(true);
    expect(check("2027-02-01")).toMatchObject({ ok: false, reason: "expired" });
  });

  it("fails before the license is effective", () => {
    expect(check("2024-12-31")).toMatchObject({ ok: false, reason: "not_yet_effective" });
  });

  it("ignores an inactive license", () => {
    const result = checkLicense([{ ...illinois, status: "inactive" }], {
      subdivision: "US-IL",
      linesOfAuthority: ["Property"],
      on: date("2026-06-01"),
      place: "Illinois",
    });

    expect(result).toMatchObject({ ok: false, reason: "inactive" });
  });
});

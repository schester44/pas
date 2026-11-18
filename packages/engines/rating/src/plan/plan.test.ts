import { describe, expect, it } from "vitest";
import type { RatingInput } from "../contract";
import { checkRatingPlan } from "./check";
import { compileRatingPlan } from "./compile";
import type { RatingPlan } from "./schema";

const plan: RatingPlan = {
  key: "ho3",
  version: "1",
  currency: "USD",
  rounding: { mode: "half_up", places: 2 },
  minimumPremium: "1000",
  tables: [
    {
      key: "base_rates",
      dimensions: [
        { name: "territory", match: "exact" },
        { name: "protectionClass", match: "band" },
      ],
      rows: [
        { keys: ["T1", { from: 1, to: 5 }], value: "400" },
        { keys: ["T1", { from: 5, to: 9 }], value: "520" },
        { keys: ["T1", { from: 9 }], value: "800" },
      ],
      default: "999",
    },
    {
      key: "roof_age",
      dimensions: [{ name: "roofAge", match: "band" }],
      rows: [
        { keys: [{ to: 10 }], value: "1.00" },
        { keys: [{ from: 10, to: 20 }], value: "1.15" },
        { keys: [{ from: 20 }], value: "1.40" },
      ],
    },
    {
      key: "amount_of_insurance",
      dimensions: [{ name: "limit", match: "interpolate" }],
      rows: [
        { keys: [100000], value: "0.80" },
        { keys: [200000], value: "1.00" },
        { keys: [400000], value: "1.50" },
      ],
    },
  ],
  algorithms: [
    {
      coverage: "DWELLING",
      exposure: "dwellings[]",
      minimumPremium: "500",
      premium: "premium",
      steps: [
        { name: "premium", op: "round", value: { step: "subtotal" }, mode: "half_up", places: 0 },
        {
          name: "subtotal",
          op: "multiply",
          operands: [{ step: "base" }, { step: "roof" }, { step: "aoi" }, { step: "alarm" }],
        },
        {
          name: "base",
          op: "lookup",
          table: "base_rates",
          keys: [{ path: "risk.territory" }, { path: "exposure.protectionClass" }],
        },
        { name: "roof", op: "lookup", table: "roof_age", keys: [{ path: "exposure.roofAge" }] },
        {
          name: "aoi",
          op: "lookup",
          table: "amount_of_insurance",
          keys: [{ path: "coverage.limit" }],
        },
        {
          name: "alarm",
          op: "if",
          condition: "exposure.alarm == true",
          whenTrue: { value: "0.95" },
          whenFalse: { value: 1 },
        },
      ],
    },
    {
      coverage: "TERRORISM",
      premium: "charge",
      minimumPremium: "5",
      steps: [
        { name: "dwellings", op: "sumCoverages", coverages: ["DWELLING"], scope: "policy" },
        { name: "charge", op: "expression", expression: "dwellings * 0.01" },
      ],
    },
  ],
};

const input = (dwellings: Record<string, unknown>[]): RatingInput => ({
  risk: { territory: "T1", dwellings },
  coverages: [
    ...dwellings.map((d, i) => ({
      coverage: "DWELLING",
      exposure: `dwellings[${i}]`,
      limit: String(d.limit),
    })),
    { coverage: "TERRORISM" },
  ],
  term: { effective: "2027-01-01", expiration: "2028-01-01" },
  transaction: { type: "NEW_BUSINESS", effective: "2027-01-01" },
  jurisdiction: { country: "US", subdivision: "US-IL" },
  currency: "USD",
});

const amounts = (result: ReturnType<ReturnType<typeof compileRatingPlan>["rate"]>) =>
  result.coverages.map((c) => [c.coverage, c.exposure, c.premium.toString()]);

describe("rating plan engine", () => {
  const rater = compileRatingPlan(plan);

  it("chains banded and interpolated lookups, rounds, and applies coverage and policy minimums", () => {
    const two = rater.rate(
      input([
        { protectionClass: 6, roofAge: 12, alarm: true, limit: 300000 },
        { protectionClass: 2, roofAge: 3, alarm: false, limit: 100000 },
      ]),
    );

    // 520 × 1.15 × 1.25 (interpolated) × 0.95 = 710.125 → 710; 400 × 1 × 0.8 × 1 = 320 → minimum 500.
    expect(amounts(two)).toEqual([
      ["DWELLING", "dwellings[0]", "710"],
      ["DWELLING", "dwellings[1]", "500"],
      ["TERRORISM", undefined, "12.1"],
    ]);

    expect(two.adjustments.map((a) => [a.scope, a.exposure, a.adjustment.toString()])).toEqual([
      ["coverage", "dwellings[1]", "180"],
    ]);

    expect(two.total.toString()).toBe("1222.1");

    expect(
      two.worksheet.find((s) => s.exposure === "dwellings[0]" && s.name === "aoi")?.output,
    ).toBe("1.25");

    const one = rater.rate(
      input([{ protectionClass: 9, roofAge: 25, alarm: false, limit: 150000 }]),
    );

    // 800 × 1.4 × 0.9 = 1008 → terrorism 10.08; total 1018.08 clears the 1000 policy minimum.
    expect(one.total.toString()).toBe("1018.08");

    const small = rater.rate(
      input([{ protectionClass: 3, roofAge: 1, alarm: true, limit: 100000 }]),
    );

    expect(amounts(small)).toEqual([
      ["DWELLING", "dwellings[0]", "500"],
      ["TERRORISM", undefined, "5"],
    ]);

    expect(small.adjustments.at(-1)).toMatchObject({ scope: "policy" });
    expect(small.adjustments.at(-1)?.adjustment.toString()).toBe("495");
    expect(small.total.toString()).toBe("1000");
  });

  it("rejects cycles and unknown references before rating", () => {
    const broken: RatingPlan = {
      ...plan,
      algorithms: [
        {
          coverage: "DWELLING",
          exposure: "dwellings[]",
          premium: "a",
          steps: [
            { name: "a", op: "add", operands: [{ step: "b" }, { path: "exposure.unknownField" }] },
            { name: "b", op: "multiply", operands: [{ step: "a" }, { value: 2 }] },
          ],
        },
      ],
    };

    expect(() => compileRatingPlan(broken)).toThrow(/Circular steps/);

    expect(
      checkRatingPlan(
        broken,
        ["territory", "dwellings[]", "dwellings[].protectionClass"],
        ["DWELLING"],
      ).map((issue) => issue.message),
    ).toEqual(["Circular steps: a, b", "Unknown path exposure.unknownField"]);
  });
});

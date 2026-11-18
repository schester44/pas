import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import {
  cancellationReturn,
  feesOnCancellation,
  type MinimumEarned,
  premiumDelta,
  prorate,
} from "./proration";

const d = (value: string) => Temporal.PlainDate.from(value);
const usd = (amount: string) => Money.of(amount, "USD");
const cents = { places: 2, mode: "half_up" as const };
const term = { termStart: d("2027-08-01"), termEnd: d("2028-08-01") };

const lines = (dwelling: string, liability: string) => [
  { coverage: "dwelling", exposure: "locations[0]", name: "Dwelling", premium: usd(dwelling) },
  { coverage: "personal_liability", name: "Personal liability", premium: usd(liability) },
];

const amounts = (changes: { coverage: string; amount: Money }[]) =>
  changes.map((c) => [c.coverage, c.amount.toString()]);

describe("prorate", () => {
  it("prorates by days left in a leap-year term and rounds per line", () => {
    const from = { ...term, from: d("2028-02-01") };

    expect(prorate(usd("1000"), from, cents).toString()).toBe("497.27");
    expect(prorate(usd("1000"), { ...term, from: term.termStart }, cents).toString()).toBe("1000");
    expect(prorate(usd("1000"), { ...term, from: term.termEnd }, cents).toString()).toBe("0");
  });

  it("refuses a date outside the term", () => {
    expect(() => prorate(usd("1"), { ...term, from: d("2027-07-31") }, cents)).toThrow(/outside/);
  });
});

describe("premiumDelta", () => {
  it("bills increases and credits decreases per coverage, skipping unchanged ones", () => {
    const from = { ...term, from: d("2027-11-01") };

    const up = premiumDelta(lines("1330", "72"), lines("1450", "72"), from, cents);
    expect(amounts(up)).toEqual([["dwelling", "89.84"]]);
    expect(up[0]!.before.toString()).toBe("1330");

    const down = premiumDelta(lines("1330", "72"), lines("1200", "60.5"), from, cents);

    expect(amounts(down)).toEqual([
      ["dwelling", "-97.32"],
      ["personal_liability", "-8.61"],
    ]);
  });

  it("charges an added coverage and credits a removed one", () => {
    const from = { ...term, from: d("2028-05-01") };

    const added = [
      ...lines("1330", "72"),
      {
        coverage: "water_backup",
        exposure: "locations[0]",
        name: "Water backup",
        premium: usd("95"),
      },
    ];

    expect(amounts(premiumDelta(lines("1330", "72"), added, from, cents))).toEqual([
      ["water_backup", "23.88"],
    ]);

    expect(amounts(premiumDelta(added, lines("1330", "72"), from, cents))).toEqual([
      ["water_backup", "-23.88"],
    ]);
  });
});

describe("cancellationReturn", () => {
  const percent: MinimumEarned = {
    type: "percent",
    value: "25",
    level: "policy",
    appliesTo: ["insured_request", "nonpayment"],
  };

  it("returns the unearned premium pro rata when no minimum applies", () => {
    const result = cancellationReturn(
      lines("1330", "72"),
      { ...term, from: d("2027-09-01") },
      cents,
    );

    expect(amounts(result.lines)).toEqual([
      ["dwelling", "-1217.35"],
      ["personal_liability", "-65.9"],
    ]);

    expect(result.minimumEarned).toBeNull();
  });

  it("keeps 25% of the policy premium on an early insured-requested cancellation", () => {
    const result = cancellationReturn(
      lines("1330", "72"),
      { ...term, from: d("2027-09-01") },
      cents,
      {
        minimumEarned: percent,
        codes: ["insured_request", "insured"],
      },
    );

    expect(result.minimumEarned?.minimum.toString()).toBe("350.5");
    expect(result.minimumEarned?.retained.toString()).toBe("231.75");
    expect(result.minimumEarned?.lines[0]?.name).toBe("Minimum earned premium");
  });

  it("doesn't apply to an underwriting cancellation or once pro rata earned exceeds it", () => {
    const early = { ...term, from: d("2027-09-01") };

    expect(
      cancellationReturn(lines("1330", "72"), early, cents, {
        minimumEarned: percent,
        codes: ["underwriting", "company"],
      }).minimumEarned,
    ).toBeNull();

    expect(
      cancellationReturn(lines("1330", "72"), { ...term, from: d("2028-03-01") }, cents, {
        minimumEarned: percent,
        codes: ["insured_request"],
      }).minimumEarned,
    ).toBeNull();
  });

  it("applies a flat minimum per coverage and never keeps more than the return", () => {
    const flat: MinimumEarned = { type: "flat", value: "100", level: "coverage", appliesTo: [] };

    const result = cancellationReturn(
      lines("1330", "72"),
      { ...term, from: term.termStart },
      cents,
      {
        minimumEarned: flat,
      },
    );

    expect(result.minimumEarned?.lines.map((l) => [l.coverage, l.amount.toString()])).toEqual([
      ["dwelling", "100"],
      ["personal_liability", "72"],
    ]);
  });
});

describe("feesOnCancellation", () => {
  it("returns premium taxes, prorates flat fees and keeps fully earned fees", () => {
    const fees = feesOnCancellation(
      [
        {
          code: "SL_TAX",
          label: "Surplus lines tax",
          remitter: "licensee",
          basis: "premium",
          amount: usd("-35.00"),
        },
        {
          code: "INSPECTION",
          label: "Inspection fee",
          remitter: "carrier",
          basis: "flat",
          amount: usd("50"),
        },
        {
          code: "POLICY_FEE",
          label: "Policy fee",
          remitter: "carrier",
          basis: "flat",
          amount: usd("25"),
        },
      ],
      [
        { code: "INSPECTION", amount: usd("50") },
        { code: "POLICY_FEE", amount: usd("25") },
      ],
      { ...term, from: d("2028-02-01") },
      cents,
      ["POLICY_FEE"],
    );

    expect(fees.map((f) => [f.code, f.amount.toString()])).toEqual([
      ["SL_TAX", "-35"],
      ["INSPECTION", "-24.86"],
    ]);
  });
});

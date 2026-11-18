import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { computeTaxesAndFees, type TaxFeeRule, totalOf } from "./taxes-fees";

const rule = (overrides: Partial<TaxFeeRule> & Pick<TaxFeeRule, "code" | "basis">): TaxFeeRule => ({
  label: overrides.code,
  taxable: false,
  remitter: "licensee",
  ...overrides,
});

const cents = { mode: "half_up" as const, places: 2 };

describe("computeTaxesAndFees", () => {
  it("levies premium-based lines on the premium and rounds each line to cents", () => {
    const lines = computeTaxesAndFees(
      [
        rule({ code: "SL_TAX", basis: "premium", rate: "0.035" }),
        rule({ code: "STAMPING", basis: "premium", rate: "0.0004" }),
      ],
      Money.of("2728"),
      cents,
    );

    expect(lines.map((l) => [l.code, l.amount.toString()])).toEqual([
      ["SL_TAX", "95.48"],
      ["STAMPING", "1.09"],
    ]);

    expect(totalOf(lines, "USD").toString()).toBe("96.57");
  });

  it("taxes the premium plus taxable fees, wherever the fee sits in the list", () => {
    const lines = computeTaxesAndFees(
      [
        rule({ code: "TAX", basis: "premium_and_fees", rate: "0.05" }),
        rule({ code: "POLICY_FEE", basis: "flat", amount: "25", currency: "USD", taxable: true }),
        rule({ code: "INSPECTION", basis: "flat", amount: "100", currency: "USD" }),
      ],
      Money.of("1000"),
      cents,
    );

    expect(lines.map((l) => [l.code, l.amount.toString()])).toEqual([
      ["TAX", "51.25"],
      ["POLICY_FEE", "25"],
      ["INSPECTION", "100"],
    ]);
  });

  it("uses the line's own rounding when the decision sets one", () => {
    const [up, even] = computeTaxesAndFees(
      [
        rule({ code: "UP", basis: "premium", rate: "0.01", rounding: "up", places: 0 }),
        rule({ code: "EVEN", basis: "premium", rate: "0.005", rounding: "half_even" }),
      ],
      Money.of("1001"),
      cents,
    );

    expect(up!.amount.toString()).toBe("11");
    expect(even!.amount.toString()).toBe("5");
  });

  it("refuses lines it can't price", () => {
    expect(() =>
      computeTaxesAndFees([rule({ code: "X", basis: "premium" })], Money.of("1"), cents),
    ).toThrow(/needs a rate/);

    expect(() =>
      computeTaxesAndFees(
        [rule({ code: "X", basis: "flat", amount: "5", currency: "EUR" })],
        Money.of("1"),
        cents,
      ),
    ).toThrow(/EUR/);
  });
});

import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { withCancellationCharges } from "./cancellation-charges";
import type { PremiumChange, RetainedLine } from "./proration";

const usd = (amount: string) => Money.of(amount, "USD");

const returned = [
  { coverage: "dwelling", name: "Dwelling", amount: usd("-300") },
] as PremiumChange[];

const minimum: RetainedLine[] = [
  { name: "Minimum earned premium", minimum: usd("100"), amount: usd("100") },
];

describe("withCancellationCharges", () => {
  it("adds charges as retained lines with their own codes", () => {
    const lines = withCancellationCharges(
      returned,
      minimum,
      [{ code: "SHORT_RATE", description: "Short-rate penalty", amount: "150.50" }],
      "USD",
    );

    expect(lines.map((l) => [l.code ?? "MINIMUM_EARNED", l.amount.toString()])).toEqual([
      ["MINIMUM_EARNED", "100"],
      ["SHORT_RATE", "150.5"],
    ]);
  });

  it("refuses charges beyond what's left to return, and amounts that aren't cents", () => {
    const charge = (amount: string) => [{ code: "FEE", description: "Fee", amount }];

    expect(withCancellationCharges(returned, minimum, charge("200"), "USD")).toHaveLength(2);

    expect(() => withCancellationCharges(returned, minimum, charge("200.01"), "USD")).toThrow(
      /left to return/,
    );

    expect(() => withCancellationCharges(returned, [], charge("1.005"), "USD")).toThrow(/cents/);
  });
});

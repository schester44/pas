import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { adjustPremium } from "./underwriter-terms";

const line = (coverage: string, amount: string) => ({ coverage, premium: Money.of(amount, "USD") });
const rounding = { mode: "half_up" as const, places: 2 };

describe("adjustPremium", () => {
  it("loads every line and keeps the lines adding up to the rounded total", () => {
    const { lines, amount } = adjustPremium(
      [line("dwelling", "0.01"), line("liability", "0.01"), line("water", "0.01")],
      "50",
      rounding,
    );

    const total = lines.reduce((sum, l) => sum.plus(l.premium), Money.zero("USD"));

    expect(lines.map((l) => l.premium.toString())).toEqual(["0.02", "0.02", "0.01"]);
    expect(total.toString()).toBe("0.05");
    expect(amount.toString()).toBe("0.02");
  });

  it("credits with a negative percentage", () => {
    const { lines, amount } = adjustPremium([line("dwelling", "1200")], "-10", rounding);

    expect(lines[0]!.premium.toString()).toBe("1080");
    expect(amount.toString()).toBe("-120");
  });
});

import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { pickOption, type QuoteOption } from "./quote-options";

const option = (id: string, outcome: QuoteOption["outcome"], total: string): QuoteOption => ({
  productId: id,
  productReleaseId: id,
  productVersionId: id,
  productVersion: "1",
  outcome,
  total: Money.of(total, "USD"),
  reasons: [],
  chosen: false,
});

describe("pickOption", () => {
  const options = [
    option("a", "referred", "900"),
    option("b", "quoted", "1200.50"),
    option("c", "quoted", "1100.25"),
    option("d", "declined", "0"),
  ];

  it("takes the first quoted in member order, ahead of referrals", () => {
    expect(pickOption(options, "first_eligible")?.productId).toBe("b");
  });

  it("takes the lowest total among quoted options, ignoring cheaper referrals", () => {
    expect(pickOption(options, "cheapest")?.productId).toBe("c");
  });

  it("leaves the choice to the agent when several options can proceed", () => {
    expect(pickOption(options, "all_eligible")).toBeNull();
    expect(pickOption([options[1]!, options[3]!], "all_eligible")?.productId).toBe("b");
  });

  it("falls back to a referral, then to the first decline so its reasons show", () => {
    expect(pickOption([options[3]!, options[0]!], "cheapest")?.productId).toBe("a");

    expect(pickOption([option("x", "declined", "0"), options[3]!], "cheapest")?.productId).toBe(
      "x",
    );
  });
});

import { describe, expect, it } from "vitest";
import { matchesPattern, subscriptionMatches } from "./matching";

const bound = {
  type: "policy.issued",
  facets: { product: "homeowners-coastal", premium: 6120.5, jurisdiction: "US-FL" },
};

const subscriber = (eventTypes: string[], filter: string | null = null) => ({
  status: "active" as const,
  eventTypes,
  filter,
});

describe("subscription matching", () => {
  it("matches exact types, group wildcards and everything", () => {
    expect(matchesPattern("policy.issued", "policy.issued")).toBe(true);
    expect(matchesPattern("policy.*", "policy.cancellation_scheduled")).toBe(true);
    expect(matchesPattern("policy.*", "payment.failed")).toBe(false);
    expect(matchesPattern("pol*", "policy.issued")).toBe(false);
    expect(matchesPattern("*", "filing.rejected")).toBe(true);
  });

  it("applies the filter expression to the event's facets", () => {
    const filter = 'product == "homeowners-coastal" and premium > 5000';

    expect(subscriptionMatches(subscriber(["policy.*"], filter), bound)).toBe(true);

    expect(
      subscriptionMatches(subscriber(["policy.*"], filter), {
        ...bound,
        facets: { ...bound.facets, premium: 4999.99 },
      }),
    ).toBe(false);

    expect(subscriptionMatches(subscriber(["quote.*"], filter), bound)).toBe(false);
  });

  it("never matches when disabled or when the filter fails at runtime", () => {
    expect(subscriptionMatches({ ...subscriber(["*"]), status: "disabled" }, bound)).toBe(false);
    expect(subscriptionMatches(subscriber(["*"], "premium > "), bound)).toBe(false);
    expect(subscriptionMatches(subscriber(["*"], "missing.field > 1"), bound)).toBe(false);
  });
});

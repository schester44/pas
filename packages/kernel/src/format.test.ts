import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import { Money } from "./money";

describe("formatMoney", () => {
  it("shows cents unless told otherwise, and drops them from whole amounts on auto", () => {
    expect(formatMoney(Money.of("1330", "USD"))).toBe("$1,330.00");
    expect(formatMoney({ amount: "1330.4", currency: "USD" }, { cents: false })).toBe("$1,330");
    expect(formatMoney({ amount: "1330", currency: "USD" }, { cents: "auto" })).toBe("$1,330");
    expect(formatMoney({ amount: "49.1", currency: "USD" }, { cents: "auto" })).toBe("$49.10");
  });
});

import { describe, expect, it } from "vitest";
import { Money } from "./money";

describe("Money", () => {
  it("keeps decimal precision and rounds only when asked", () => {
    const premium = Money.of("0.1").plus(Money.of("0.2"));
    expect(premium.toString()).toBe("0.3");
    expect(Money.of("1234.565").round(2, "half_up").toString()).toBe("1234.57");
    expect(Money.of("1234.565").round(2, "half_even").toString()).toBe("1234.56");
  });

  it("round-trips through JSON", () => {
    expect(Money.fromJSON(Money.of("49.10", "CAD").toJSON()).equals(Money.of("49.1", "CAD"))).toBe(
      true,
    );
  });

  it("refuses to mix currencies", () => {
    expect(() => Money.of(1, "USD").plus(Money.of(1, "CAD"))).toThrow();
  });
});

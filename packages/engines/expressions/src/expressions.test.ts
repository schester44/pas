import { describe, expect, it } from "vitest";
import {
  createScope,
  evaluate,
  evaluateUnary,
  ExpressionError,
  isReady,
  referencedPaths,
  validate,
} from "./node";

describe("expressions", () => {
  it("is ready synchronously in node", () => {
    expect(isReady()).toBe(true);
  });

  it("evaluates standard and unary expressions", () => {
    const risk = { insured: { state: "IL" }, priorClaims: 2 };
    expect(evaluate('insured.state == "IL" and priorClaims > 1', risk)).toBe(true);
    expect(evaluate("missing.path", risk)).toBeNull();

    expect(evaluate("{ rate: rate * 2, list: [1.25] }", { rate: 0.035 })).toEqual({
      rate: 0.07,
      list: [1.25],
    });

    expect(evaluateUnary('in ["IL", "IN"]', { $: "IN" })).toBe(true);
    expect(evaluateUnary("> 5", { $: 3 })).toBe(false);
    expect(() => evaluate("1 +")).toThrow(ExpressionError);
  });

  it("evaluates scopes with an extra root", () => {
    const scope = createScope({ minYear: 1900 });
    const row = scope.with("$item", { yearBuilt: 1950 });
    expect(row.evaluate("$item.yearBuilt > minYear")).toBe(true);
    row.dispose();
    scope.dispose();
  });

  it("validates", () => {
    expect(validate("a + 1")).toEqual({ ok: true });
    expect(validate("a +").ok).toBe(false);
    expect(validate("  ").ok).toBe(false);
  });

  it("extracts referenced paths", () => {
    expect(
      referencedPaths('insured.address.city == "Chicago" and some(locations, #.roofAge > 20)'),
    ).toEqual(["insured.address.city", "locations", "locations[].roofAge"]);

    expect(
      referencedPaths("$item.yearBuilt < 1950 and $index > 0", {
        aliases: { $item: "locations[]", $index: null },
      }),
    ).toEqual(["locations[].yearBuilt"]);

    expect(
      referencedPaths("len(filter(locations, #.x > 1)) > 0 and locations[0].name != null"),
    ).toEqual(["locations", "locations[].x", "locations[].name"]);

    expect(referencedPaths("> limit", { unary: true })).toEqual(["limit"]);
    expect(() => referencedPaths("a +")).toThrow(ExpressionError);
  });
});

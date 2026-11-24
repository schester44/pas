import { describe, expect, it } from "vitest";
import { storable } from "./execute";

describe("storable", () => {
  it("drops NUL characters but keeps text that merely spells \\u0000", () => {
    expect(storable({ a: "x\u0000y", b: ["\u0000"] })).toEqual({ a: "xy", b: [""] });
    expect(storable({ a: "\\u0000" })).toEqual({ a: "\\u0000" });
    expect(storable({ a: "\\\u0000" })).toEqual({ a: "\\" });
  });
});

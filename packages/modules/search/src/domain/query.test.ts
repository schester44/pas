import { describe, expect, it } from "vitest";
import { classifyQuery, escapeLike } from "./query";

describe("classifyQuery", () => {
  it("routes document number prefixes to their types", () => {
    expect(classifyQuery("POL-0000")).toMatchObject({
      kind: "number",
      prefix: "POL",
      digits: "0000",
      types: ["policy", "invoice"],
    });

    expect(classifyQuery(" sub-12 ")).toMatchObject({
      prefix: "SUB",
      digits: "12",
      types: ["submission"],
    });

    expect(classifyQuery("inv")).toMatchObject({ kind: "text" });
    expect(classifyQuery("INV-")).toMatchObject({ kind: "number", prefix: "INV", digits: "" });
    expect(classifyQuery("inv7")).toMatchObject({ kind: "number", prefix: "INV", digits: "7" });
  });

  it("treats digits and phone-like input as numbers across numbered types", () => {
    expect(classifyQuery("0006")).toMatchObject({ kind: "digits", digits: "0006" });
    expect(classifyQuery("(312) 555-0100")).toMatchObject({ kind: "digits", digits: "3125550100" });
    expect(classifyQuery("42")?.types).toEqual(["policy", "submission", "invoice", "client"]);
  });

  it("falls back to free text and ignores input too short to be useful", () => {
    expect(classifyQuery("casey   morgan")).toMatchObject({ kind: "text", text: "casey morgan" });
    expect(classifyQuery("abc-12")).toMatchObject({ kind: "text" });
    expect(classifyQuery("c")).toBeNull();
    expect(classifyQuery("   ")).toBeNull();
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

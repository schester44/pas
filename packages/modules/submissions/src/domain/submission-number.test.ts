import { describe, expect, it } from "vitest";
import { formatSubmissionNumber } from "./submission-number";

describe("formatSubmissionNumber", () => {
  it("pads to the minimum width and grows past it", () => {
    expect(formatSubmissionNumber(123)).toBe("SUB-000123");
    expect(formatSubmissionNumber(1_234_567)).toBe("SUB-1234567");
    expect(formatSubmissionNumber(7, { prefix: "Q", minDigits: 3 })).toBe("Q007");
  });

  it("rejects sequences that can't come from the counter", () => {
    expect(() => formatSubmissionNumber(0)).toThrow();
    expect(() => formatSubmissionNumber(1.5)).toThrow();
  });
});

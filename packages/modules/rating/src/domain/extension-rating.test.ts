import type { RatingInput } from "@pas/rating-engine";
import { describe, expect, it } from "vitest";
import { ratingResultFromExtension } from "./extension-rating";

const source = { engine: "extension" as const, extensionVersionId: "v1", currency: "USD" };

const input: RatingInput = {
  risk: {},
  coverages: [{ coverage: "dwelling" }, { coverage: "liability" }],
  term: { effective: "2027-01-01", expiration: "2028-01-01" },
  transaction: { type: "NEW_BUSINESS", effective: "2027-01-01" },
  jurisdiction: { country: "US", subdivision: "IL" },
  currency: "USD",
};

const output = (coverages: { coverage: string; premium: string }[]) => ({
  coverages,
  factors: [],
  warnings: [],
});

describe("ratingResultFromExtension", () => {
  it("totals the priced coverages in decimal money", () => {
    const result = ratingResultFromExtension(
      source,
      input,
      output([
        { coverage: "dwelling", premium: "1000.10" },
        { coverage: "liability", premium: "0.20" },
      ]),
    );

    expect(result.total.toString()).toBe("1000.3");
    expect(result.artifact.kind).toBe("extension");
  });

  it("refuses unselected, duplicate, missing or negative coverages and other currencies", () => {
    const run =
      (coverages: { coverage: string; premium: string }[], currency = "USD") =>
      () =>
        ratingResultFromExtension(source, { ...input, currency }, output(coverages));

    expect(run([{ coverage: "dwelling", premium: "1" }])).toThrow(/didn't price liability/);

    expect(
      run([
        { coverage: "dwelling", premium: "1" },
        { coverage: "liability", premium: "1" },
        { coverage: "flood", premium: "1" },
      ]),
    ).toThrow(/isn't selected/);

    expect(
      run([
        { coverage: "dwelling", premium: "1" },
        { coverage: "dwelling", premium: "1" },
      ]),
    ).toThrow(/twice/);

    expect(
      run([
        { coverage: "dwelling", premium: "-1" },
        { coverage: "liability", premium: "1" },
      ]),
    ).toThrow(/negative/);

    expect(run([], "EUR")).toThrow(/prices in USD/);

    expect(
      run([
        { coverage: "dwelling", premium: "100.125" },
        { coverage: "liability", premium: "1" },
      ]),
    ).toThrow(/more than 2 decimals/);
  });
});

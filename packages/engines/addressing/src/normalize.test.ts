import { describe, expect, it } from "vitest";
import { createFakeAddressProvider } from "./fake";
import { normalizeUnit, registryKey, splitUnit, textKey } from "./normalize";

const signal = new AbortController().signal;
const fake = createFakeAddressProvider();

const verify = (input: Parameters<NonNullable<typeof fake.verify>>[0]) =>
  fake.verify!(input, { signal });

describe("registry keys", () => {
  it("normalizes unit designators to one unit", () => {
    expect(
      ["Apt 2B", "unit 2-b", "#2b", "Apartment 2B", "APT #2B", "2b"].map(normalizeUnit),
    ).toEqual(Array(6).fill("2B"));

    expect(normalizeUnit("Floor 3")).toBe("FL 3");
    expect(normalizeUnit("Bsmt")).toBe("BSMT");
    expect(normalizeUnit("")).toBe("");
  });

  it("splits units off street lines but leaves street names alone", () => {
    expect(splitUnit("1420 Elmwood Ave Apt 4")).toEqual({
      street: "1420 Elmwood Ave",
      unit: "Apt 4",
    });

    expect(splitUnit("1420 Elmwood Ave #4")).toEqual({ street: "1420 Elmwood Ave", unit: "#4" });
    expect(splitUnit("12 Front St")).toEqual({ street: "12 Front St", unit: "" });
    expect(splitUnit("9 Lot Ave")).toEqual({ street: "9 Lot Ave", unit: "" });
  });

  it("gives the same address in different formatting the same key", async () => {
    const a = {
      line1: "1420 Elmwood Avenue",
      city: "Evanston",
      region: "IL",
      postalCode: "60201",
      country: "US",
    };

    const b = {
      line1: "1420 elmwood ave.",
      city: "EVANSTON",
      region: "il",
      postalCode: "60201-1234",
      country: "US",
    };

    expect(textKey(a)).toBe(textKey(b));
    expect(registryKey(await verify(a))).toBe(registryKey(await verify(b)));
    expect(registryKey(await verify(a))).toMatch(/^builtin_address:\d{10}#$/);
  });

  it("keeps different units apart and treats unit spellings as one", async () => {
    const base = {
      line1: "1600 Chicago Ave",
      city: "Evanston",
      region: "IL",
      postalCode: "60201",
      country: "US",
    };

    const two = await verify({ ...base, line2: "Apt 2B" });
    const twoAgain = await verify({ ...base, line1: "1600 Chicago Avenue #2b" });
    const three = await verify({ ...base, line2: "Unit 3A" });

    expect(two.providerAddressId).toBe(three.providerAddressId);
    expect(registryKey(two)).toBe(registryKey(twoAgain));
    expect(registryKey(two)).not.toBe(registryKey(three));
    expect(textKey({ ...base, line2: "Apt 2B" })).not.toBe(textKey({ ...base, line2: "Apt 3A" }));
  });

  it("falls back to the text key when an address can't be verified", async () => {
    const input = {
      line1: "5891 Wilson Drive",
      city: "Bethel Park",
      region: "PA",
      postalCode: "15102",
      country: "US",
    };

    const result = await verify(input);

    expect(result.status).toBe("unverified");
    expect(registryKey(result)).toBe(textKey(input));
    expect(registryKey(result)).toBe(textKey({ ...input, line1: "5891 wilson dr" }));
  });
});

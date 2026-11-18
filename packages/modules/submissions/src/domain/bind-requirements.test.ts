import { describe, expect, it } from "vitest";
import type { BindDetails } from "./bind-details";
import { deriveBindRequirements, outstandingFor } from "./bind-requirements";

const details = (overrides: Partial<BindDetails> = {}): BindDetails => ({
  namedInsureds: ["Jordan Avery"],
  mailingAddress: {
    line1: "41 Lakeshore Drive",
    city: "Evanston",
    region: "IL",
    postalCode: "60201",
    country: "US",
  },
  additionalInterests: [],
  producer: { name: "Morgan Lee" },
  declinations: [],
  acknowledgements: [],
  ...overrides,
});

const declination = { carrier: "Admitted Mutual", declinedOn: "2027-05-02", reason: "Coastal" };

const search = (overrides = {}) => ({
  required: true,
  declinationsRequired: 3,
  timing: "pre_bind" as const,
  exemptions: [],
  ...overrides,
});

const base = { attestations: [], signed: false, paid: false };

describe("deriveBindRequirements", () => {
  it("asks for parties, signature and payment when no decision adds anything", () => {
    const requirements = deriveBindRequirements({ ...base, diligentSearch: null, details: null });

    expect(requirements.map((r) => [r.id, r.satisfied])).toEqual([
      ["parties", false],
      ["signature", false],
      ["payment", false],
    ]);
  });

  it("requires the declinations the diligent search decision asks for before binding", () => {
    const two = details({ declinations: [declination, declination] });

    const [, open] = deriveBindRequirements({ ...base, diligentSearch: search(), details: two });

    expect(open).toMatchObject({ kind: "diligent_search", blocking: true, satisfied: false });

    const three = details({
      declinations: [declination, declination, { ...declination, carrier: "State Farmers" }],
    });

    const [, done] = deriveBindRequirements({ ...base, diligentSearch: search(), details: three });

    expect(done!.satisfied).toBe(true);
  });

  it("skips the search when an exemption applies and doesn't block when it's due after binding", () => {
    const exempt = deriveBindRequirements({
      ...base,
      diligentSearch: search({ exemptions: ["exempt_commercial_purchaser"] }),
      details: details(),
    });

    expect(exempt.some((r) => r.kind === "diligent_search")).toBe(false);

    const later = deriveBindRequirements({
      ...base,
      diligentSearch: search({ timing: "post_bind" }),
      details: details(),
    });

    expect(later.find((r) => r.kind === "diligent_search")).toMatchObject({ blocking: false });
    expect(outstandingFor(later, "sign")).toEqual([]);
  });

  it("turns each attestation into a requirement that its acknowledgement meets", () => {
    const requirements = deriveBindRequirements({
      ...base,
      diligentSearch: null,
      attestations: [
        { code: "SL_NOTICE", title: "Surplus lines notice", statement: "Not covered by guaranty" },
        { code: "ACCURATE", title: "Accuracy", statement: "Answers are true" },
      ],
      details: details({ acknowledgements: [{ code: "ACCURATE", acceptedAt: "2026-11-18" }] }),
    });

    expect(outstandingFor(requirements, "sign").map((r) => r.id)).toEqual([
      "attestation:SL_NOTICE",
    ]);
  });

  it("needs a signature before payment, and nothing more to bind once paid", () => {
    const signed = deriveBindRequirements({
      ...base,
      diligentSearch: null,
      details: details(),
      signed: true,
    });

    expect(outstandingFor(signed, "pay")).toEqual([]);
    expect(outstandingFor(signed, "bind").map((r) => r.id)).toEqual(["payment"]);
  });
});

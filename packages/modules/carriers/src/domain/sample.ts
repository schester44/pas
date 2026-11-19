import type { CanonicalInput } from "./canonical";
import type { Capability } from "./connector";

const usd = (amount: string) => ({ amount, currency: "USD" });

/** A homeowner in the canonical model, for the test console and mapping previews. */
export function sampleInput(capability: Capability): CanonicalInput {
  const changes = capability === "endorse" || capability === "cancel" || capability === "reinstate";

  return {
    capability,
    product: {
      id: "sample-product",
      name: "Homeowners",
      version: "sample",
      releaseId: "sample-release",
    },
    jurisdiction: { country: "US", subdivision: "FL" },
    term: { effectiveDate: "2028-03-01", expirationDate: "2029-03-01" },
    policy: changes
      ? { id: "sample-policy", number: "HO-000123", carrierNumber: "LKM-HO-000123" }
      : {},
    quote: { id: "sample-quote", number: "S-000123", revision: 1 },
    ...(changes && {
      transaction: {
        id: "sample-transaction",
        type:
          capability === "cancel"
            ? "CANCELLATION"
            : capability === "endorse"
              ? "ENDORSEMENT"
              : "REINSTATEMENT",
        effectiveDate: "2028-06-01",
        ...(capability === "cancel" && { reason: "insured_request" }),
        premiumChange: usd(capability === "cancel" ? "-1210.00" : "180.00"),
      },
    }),
    insured: {
      name: "Jordan Rivera",
      mailingAddress: {
        line1: "18 Harbor View Lane",
        city: "Sarasota",
        region: "FL",
        postalCode: "34236",
        country: "US",
      },
    },
    producer: { name: "Morgan Lee", agency: null },
    risk: {
      yearBuilt: 2004,
      construction: "masonry",
      roofAge: 6,
      distanceToCoast: 2,
      coastalCounty: true,
      protectionClass: 3,
    },
    coverages: [
      {
        code: "DWELLING",
        name: "Dwelling",
        limit: { kind: "money", amount: "450000", currency: "USD" },
        premium: usd(changes ? (capability === "cancel" ? "-980.00" : "150.00") : "1840.00"),
      },
      {
        code: "PERSONAL_PROPERTY",
        name: "Personal property",
        premium: usd(changes ? (capability === "cancel" ? "-230.00" : "30.00") : "420.00"),
      },
    ],
    premium: {
      written: usd("2260.00"),
      taxesFees: [{ code: "FL_EMPA", label: "Emergency management fee", amount: usd("2.00") }],
      total: usd("2262.00"),
    },
    carrier: changes ? { policyNumber: "LKM-HO-000123", reference: "BND-0000" } : {},
  };
}

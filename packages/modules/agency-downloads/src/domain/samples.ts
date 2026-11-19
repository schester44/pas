import type { DownloadTransactionView } from "./record";
import type { TransactionKind } from "./settings";

export const SAMPLE_SCENARIOS = [
  { id: "new_business", kind: "new_business", label: "New business" },
  { id: "endorsement", kind: "endorsement", label: "Endorsement with a premium change" },
  { id: "cancellation", kind: "cancellation", label: "Cancellation with return premium" },
  { id: "reinstatement", kind: "reinstatement", label: "Reinstatement" },
] as const satisfies readonly { id: string; kind: TransactionKind; label: string }[];

export type SampleScenario = (typeof SAMPLE_SCENARIOS)[number]["id"];

const usd = (amount: string) => ({ amount, currency: "USD" });

const address = {
  line1: "100 Sample St",
  city: "Springfield",
  region: "IL",
  postalCode: "62701",
  country: "US",
};

function snapshot(dwelling: string, dwellingPremium: string, written: string) {
  return {
    risk: {
      insured: { firstName: "Pat", lastName: "Sample", email: "pat.sample@example.com" },
      locations: [{ address, yearBuilt: 1998, construction: "frame" }],
      mailingAddress: address,
    },
    parties: {
      mailingAddress: address,
      additionalInterests: [
        {
          kind: "mortgagee",
          name: "Sample Savings Bank, ISAOA/ATIMA",
          address,
          reference: "LN-000123",
        },
      ],
    },
    coverages: [
      {
        coverage: "dwelling",
        name: "Dwelling",
        exposure: "locations[0]",
        limit: { kind: "money", ...usd(dwelling) },
        deductible: { kind: "money", ...usd("1000") },
        premium: usd(dwellingPremium),
      },
      {
        coverage: "personal_liability",
        name: "Personal liability",
        limit: { kind: "money", ...usd("300000") },
        premium: usd("80"),
      },
    ],
    writtenPremium: usd(written),
  };
}

const transaction = (id: string, type: string, effectiveDate: string, premium: string) => ({
  id: `00000000-0000-7000-8000-00000000010${id}`,
  type,
  effectiveDate,
  issuedAt: `${effectiveDate}T15:00:00Z`,
  premium: usd(premium),
  reason: null,
  changes: [],
});

/**
 * Canned transactions on one sample policy for IVANS certification: the same insured and policy
 * number across scenarios, as AMS matching expects.
 */
export function sampleView(
  scenario: SampleScenario,
  context: { lineOfBusiness: string; agency: { id: string; name: string } },
): DownloadTransactionView {
  const base = {
    policy: {
      id: "00000000-0000-7000-8000-000000000001",
      number: "SAMPLE-0001",
      productName: "Sample product",
      lineOfBusiness: context.lineOfBusiness,
      insuredName: "Pat Sample",
      jurisdiction: { country: "US", subdivision: "US-IL" },
      termEffectiveDate: "2027-01-01",
      termExpirationDate: "2028-01-01",
      billingMethod: "direct",
    },
    producer: { id: "sample-producer", name: "Sample Producer", code: "P001" },
    agency: context.agency,
    documents: [],
  };

  switch (scenario) {
    case "new_business":
      return {
        ...base,
        transaction: transaction("1", "NEW_BUSINESS", "2027-01-01", "1280"),
        premiumLines: [
          { code: "dwelling", label: "Dwelling", amount: usd("1200") },
          { code: "personal_liability", label: "Personal liability", amount: usd("80") },
        ],
        taxesFees: [{ code: "POLICY_FEE", label: "Policy fee", amount: usd("25") }],
        snapshot: snapshot("400000", "1200", "1280"),
      };
    case "endorsement":
      return {
        ...base,
        transaction: {
          ...transaction("2", "ENDORSEMENT", "2027-04-01", "112.50"),
          changes: [{ label: "Dwelling limit", before: "400000", after: "450000" }],
        },
        premiumLines: [{ code: "dwelling", label: "Dwelling", amount: usd("112.50") }],
        taxesFees: [],
        snapshot: snapshot("450000", "1350", "1392.50"),
      };
    case "cancellation":
      return {
        ...base,
        transaction: {
          ...transaction("3", "CANCELLATION", "2027-07-01", "-694.40"),
          reason: "Insured's request",
        },
        premiumLines: [
          { code: "dwelling", label: "Dwelling", amount: usd("-654.52") },
          { code: "personal_liability", label: "Personal liability", amount: usd("-39.88") },
        ],
        taxesFees: [],
        snapshot: snapshot("450000", "695.48", "698.10"),
      };
    case "reinstatement":
      return {
        ...base,
        transaction: {
          ...transaction("4", "REINSTATEMENT", "2027-07-01", "694.40"),
          reason: "Reinstated without a lapse",
        },
        premiumLines: [
          { code: "dwelling", label: "Dwelling", amount: usd("654.52") },
          { code: "personal_liability", label: "Personal liability", amount: usd("39.88") },
        ],
        taxesFees: [],
        snapshot: snapshot("450000", "1350", "1392.50"),
      };
  }
}

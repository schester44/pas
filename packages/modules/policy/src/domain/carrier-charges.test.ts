import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { withCarrierCharges } from "./carrier-charges";
import type { TransactionDetails } from "./transaction";

const usd = (amount: string) => Money.of(amount, "USD");

const details: TransactionDetails = {
  after: null,
  premium: [
    {
      coverage: "dwelling",
      exposure: "locations[0]",
      name: "Dwelling",
      before: usd("1216"),
      after: usd("1141.84"),
      amount: usd("-74.16"),
    },
    {
      coverage: "liability",
      name: "Liability",
      before: usd("72"),
      after: usd("90.26"),
      amount: usd("18.26"),
    },
  ],
  retained: [],
  fees: [
    {
      code: "STATE",
      label: "State fee",
      remitter: "licensee",
      basis: "premium",
      amount: usd("-1.10"),
    },
  ],
  annualBefore: usd("1288"),
  annualAfter: usd("1232.10"),
  changes: [],
  referrals: [],
};

describe("carrier figures win on a policy change", () => {
  it("replaces premium by coverage and same-code fees, adds the carrier's, and keeps totals consistent", () => {
    const replaced = withCarrierCharges(details, {
      premium: [
        { coverage: "dwelling", exposure: "locations[0]", amount: usd("-79.35") },
        { coverage: "liability", amount: usd("19.54") },
      ],
      fees: [{ code: "LKM_FEE", label: "Carrier fee", amount: usd("5") }],
    });

    expect(
      replaced.premium.map((l) => [l.coverage, l.amount.toString(), l.after.toString()]),
    ).toEqual([
      ["dwelling", "-79.35", "1136.65"],
      ["liability", "19.54", "91.54"],
    ]);

    expect(replaced.fees.map((f) => [f.code, f.amount.toString()])).toEqual([
      ["STATE", "-1.1"],
      ["LKM_FEE", "5"],
    ]);

    expect(replaced.annualAfter.toString()).toBe("1228.19");
  });

  it("moves nothing on coverages the carrier leaves out", () => {
    const replaced = withCarrierCharges(details, {
      premium: [{ coverage: "liability", amount: usd("20") }],
      fees: [],
    });

    expect(replaced.premium[0]!.amount.isZero()).toBe(true);
  });
});

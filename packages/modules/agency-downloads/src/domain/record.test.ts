import { describe, expect, it } from "vitest";
import { reconcile, toDownloadRecord } from "./record";
import { sampleView } from "./samples";

const context = {
  enrollment: { accountCode: "YAB1D", agencyCodes: [{ carrier: "", code: "A100" }] },
  settings: { lobCodes: { homeowners: "HOME" }, coverageCodes: { dwelling: "DWELL" } },
};

const agency = { id: "agency-1", name: "Sample Agency" };

describe("toDownloadRecord", () => {
  it("books new business premium by coverage and reconciles taxes into the total", () => {
    const view = sampleView("new_business", { lineOfBusiness: "homeowners", agency });
    const record = toDownloadRecord(view, { ...context, kind: "new_business" });

    expect(record.coverages.map((c) => [c.acordCode, c.transactionPremium.amount])).toEqual([
      ["DWELL", "1200"],
      ["PERSONALLI", "80"],
    ]);

    expect(record.totals).toEqual({
      premium: { amount: "1280", currency: "USD" },
      taxesFees: { amount: "25", currency: "USD" },
      total: { amount: "1305", currency: "USD" },
    });

    expect(record.policy.acordLob).toBe("HOME");
    expect(record.agency.code).toBe("A100");
    expect(record.coverages[0]!.locationRef).toBe("L1");

    expect(record.additionalInterests[0]).toMatchObject({
      kind: "mortgagee",
      reference: "LN-000123",
    });

    expect(reconcile(record, view.transaction.premium)).toEqual([]);
  });

  it("keeps the full policy image on an endorsement but only the change as booked premium", () => {
    const view = sampleView("endorsement", { lineOfBusiness: "homeowners", agency });
    const record = toDownloadRecord(view, { ...context, kind: "endorsement" });

    expect(record.coverages.map((c) => c.termPremium.amount)).toEqual(["1350", "80"]);
    expect(record.coverages.map((c) => c.transactionPremium.amount)).toEqual(["112.50", "0"]);
    expect(record.totals.total.amount).toBe("112.5");
    expect(reconcile(record, view.transaction.premium)).toEqual([]);
  });

  it("carries premium that belongs to no coverage and flags a record that doesn't reconcile", () => {
    const view = sampleView("cancellation", { lineOfBusiness: "homeowners", agency });

    const record = toDownloadRecord(
      {
        ...view,
        premiumLines: [
          ...view.premiumLines,
          {
            code: "MINIMUM_EARNED",
            label: "Minimum earned",
            amount: { amount: "50", currency: "USD" },
          },
        ],
      },
      { ...context, kind: "cancellation" },
    );

    expect(record.otherPremium.map((p) => p.code)).toEqual(["MINIMUM_EARNED"]);
    expect(record.totals.premium.amount).toBe("-644.4");

    expect(reconcile(record, view.transaction.premium)).toEqual([
      "Premium by coverage -644.4 doesn't match -694.40 booked",
    ]);
  });
});

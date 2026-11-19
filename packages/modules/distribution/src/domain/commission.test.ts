import { describe, expect, it } from "vitest";
import { Money } from "@pas/kernel";
import { type CommissionSchedule, commissionsOn, scheduleFor, statementTotals } from "./commission";

const date = Temporal.PlainDate.from;

const schedule = (over: Partial<CommissionSchedule>): CommissionSchedule => ({
  id: "s",
  productId: null,
  country: "US",
  subdivision: null,
  business: null,
  tier: null,
  rate: "10",
  effectiveDate: date("2026-01-01"),
  expirationDate: null,
  ...over,
});

const basis = {
  productId: "ho3",
  country: "US",
  subdivision: "US-IL",
  business: "new" as const,
  tier: "standard",
  on: date("2026-06-01"),
};

describe("scheduleFor", () => {
  const schedules = [
    schedule({ id: "any", rate: "10" }),
    schedule({ id: "product", productId: "ho3", rate: "12" }),
    schedule({
      id: "product-state-new",
      productId: "ho3",
      subdivision: "US-IL",
      business: "new",
      rate: "15",
    }),
    schedule({
      id: "renewal",
      productId: "ho3",
      subdivision: "US-IL",
      business: "renewal",
      rate: "8",
    }),
    schedule({
      id: "preferred",
      productId: "ho3",
      subdivision: "US-IL",
      tier: "preferred",
      rate: "17.5",
    }),
    schedule({
      id: "future",
      productId: "ho3",
      subdivision: "US-IL",
      business: "new",
      tier: "standard",
      rate: "20",
      effectiveDate: date("2027-01-01"),
    }),
  ];

  it("picks the most specific schedule in force", () => {
    expect(scheduleFor(schedules, basis)?.id).toBe("product-state-new");
    expect(scheduleFor(schedules, { ...basis, business: "renewal" })?.id).toBe("renewal");
    expect(scheduleFor(schedules, { ...basis, subdivision: "US-IN" })?.id).toBe("product");
    expect(scheduleFor(schedules, { ...basis, on: date("2027-02-01") })?.id).toBe("future");
  });

  it("returns null when nothing matches", () => {
    expect(scheduleFor(schedules, { ...basis, country: "CA" })).toBeNull();
  });
});

const usd = (amount: string) => Money.of(amount, "USD");

describe("commissionsOn", () => {
  it("pays the rate on premium lines only, rounding each line half up", () => {
    const lines = commissionsOn(
      [
        { financialTransactionId: "dwelling", kind: "written_premium", amount: usd("1234.55") },
        { financialTransactionId: "tax", kind: "tax_fee", amount: usd("40.00") },
        { financialTransactionId: "return", kind: "written_premium", amount: usd("-100.05") },
      ],
      { id: "s", rate: "12.5" },
    );

    expect(lines.map((l) => [l.financialTransactionId, l.amount.toString()])).toEqual([
      ["dwelling", "154.32"],
      ["return", "-12.51"],
    ]);

    const totals = statementTotals(lines, "USD");

    expect([totals.gross, totals.commission, totals.net].map(String)).toEqual([
      "1134.5",
      "141.81",
      "992.69",
    ]);
  });

  it("records zero commission when no schedule applies", () => {
    const [line] = commissionsOn(
      [{ financialTransactionId: "a", kind: "written_premium", amount: usd("500") }],
      null,
    );

    expect(line?.amount.isZero()).toBe(true);
    expect(line?.scheduleId).toBeNull();
  });
});

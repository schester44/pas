import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  checkSplit,
  mortgageeFollowUps,
  netCredit,
  type PayPlan,
  spreadCharge,
} from "./index";

const rounding = { places: 2, mode: "half_up" as const };
const usd = (amount: string) => Money.of(amount, "USD");
const date = (value: string) => Temporal.PlainDate.from(value);
const amounts = (list: Money[]) => list.map((m) => m.toString());

const plan = (overrides: Partial<PayPlan>): PayPlan => ({
  key: "quarterly",
  label: "Quarterly",
  installments: 4,
  intervalMonths: 3,
  downPayment: { kind: "first_installment" },
  installmentFee: null,
  taxesFees: "up_front",
  dueDaysBefore: 0,
  billDaysBeforeDue: 14,
  graceDays: 10,
  eligibility: {},
  ...overrides,
});

const input = (premium: string, taxes = "0") => ({
  premium: usd(premium),
  taxesFees: taxes === "0" ? [] : [{ code: "TAX", label: "Premium tax", amount: usd(taxes) }],
  effectiveDate: date("2027-12-01"),
  billedOn: date("2027-11-20"),
  rounding,
});

describe("buildSchedule", () => {
  it("splits equally and puts the rounding remainder on the last installment", () => {
    const schedule = buildSchedule(plan({}), input("1000.01"));

    expect(amounts(schedule.map((i) => i.premium))).toEqual(["250", "250", "250", "250.01"]);
    expect(schedule[1]!.dueOn.toString()).toBe("2028-03-01");
    expect(schedule[1]!.issueOn.toString()).toBe("2028-02-16");
    expect(schedule[0]!.dueOn.toString()).toBe("2027-11-20");
  });

  it("takes a percent down payment, adds fees after the first and spreads taxes", () => {
    const schedule = buildSchedule(
      plan({
        installments: 10,
        intervalMonths: 1,
        downPayment: { kind: "percent", percent: "20" },
        installmentFee: "5",
        taxesFees: "spread",
      }),
      input("1234.56", "50"),
    );

    expect(schedule).toHaveLength(10);

    expect(amounts(schedule.map((i) => i.premium))).toEqual([
      "246.91",
      ...Array(8).fill("109.74"),
      "109.73",
    ]);

    expect(schedule.map((i) => i.taxesFees[0]!.amount.toString())).toEqual([
      "10",
      ...Array(8).fill("4.44"),
      "4.48",
    ]);

    expect(schedule[0]!.fee.isZero()).toBe(true);
    expect(schedule[0]!.total.toString()).toBe("256.91");
    expect(schedule[1]!.total.toString()).toBe("119.18");

    const premium = schedule.reduce((sum, i) => sum.plus(i.premium), usd("0"));
    const fees = schedule.reduce((sum, i) => sum.plus(i.fee), usd("0"));

    expect(premium.toString()).toBe("1234.56");
    expect(fees.toString()).toBe("45");
  });

  it("collects taxes up front on the first installment", () => {
    const schedule = buildSchedule(plan({}), input("1000", "40"));

    expect(schedule[0]!.total.toString()).toBe("290");
    expect(schedule[1]!.taxesFees).toEqual([]);
    expect(schedule[3]!.total.toString()).toBe("250");
  });

  it("is a single invoice for pay in full", () => {
    const schedule = buildSchedule(plan({ installments: 1 }), input("999.99", "12.34"));

    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.total.toString()).toBe("1012.33");
  });
});

describe("spreadCharge", () => {
  it("spreads an endorsement over the remaining installments, remainder last", () => {
    expect(amounts(spreadCharge(usd("100"), 3, rounding))).toEqual(["33.33", "33.33", "33.34"]);
    expect(amounts(spreadCharge(usd("100"), 1, rounding))).toEqual(["100"]);
  });
});

describe("netCredit", () => {
  const installments = [
    {
      id: "2",
      status: "open" as const,
      dueOn: date("2028-03-01"),
      balance: usd("305"),
      fee: usd("5"),
    },
    {
      id: "3",
      status: "scheduled" as const,
      dueOn: date("2028-06-01"),
      balance: usd("305"),
      fee: usd("5"),
    },
    {
      id: "4",
      status: "scheduled" as const,
      dueOn: date("2028-09-01"),
      balance: usd("305"),
      fee: usd("5"),
    },
  ];

  it("waives unbilled fees and credits the latest installments first", () => {
    const netting = netCredit(usd("600"), installments, { waiveScheduledFees: true });

    expect(
      netting.allocations.map((a) => [
        a.id,
        a.waivedFee.toString(),
        a.credited.toString(),
        a.settled,
      ]),
    ).toEqual([
      ["4", "5", "300", true],
      ["3", "5", "300", true],
    ]);

    expect(netting.refund.toString()).toBe("0");
    expect(netting.owed.toString()).toBe("305");
  });

  it("refunds only what's left after every open installment is settled", () => {
    const netting = netCredit(usd("1000"), installments, { waiveScheduledFees: true });

    expect(netting.refund.toString()).toBe("95");
    expect(netting.owed.toString()).toBe("0");
    expect(netting.allocations.every((a) => a.settled)).toBe(true);
  });

  it("partly reduces an installment when the credit runs out", () => {
    const netting = netCredit(usd("100"), installments, { waiveScheduledFees: false });

    expect(netting.allocations).toHaveLength(1);
    expect(netting.allocations[0]!.credited.toString()).toBe("100");
    expect(netting.allocations[0]!.settled).toBe(false);
    expect(netting.owed.toString()).toBe("815");
  });
});

describe("mortgagee follow-ups", () => {
  it("dates reminders, the direct-bill offer and nonpayment from the day the packet went out", () => {
    const steps = mortgageeFollowUps(
      {
        dueDays: 30,
        reminderDays: [30, 15, 15],
        offerDirectAfterDays: 30,
        nonpaymentAfterDays: 45,
      },
      date("2027-01-03"),
    );

    expect(steps.map((s) => [s.id, s.action, s.on.toString()])).toEqual([
      ["remind-15", "remind_lender", "2027-01-18"],
      ["remind-30", "remind_lender", "2027-02-02"],
      ["offer-direct", "offer_direct", "2027-02-02"],
      ["nonpayment", "nonpayment", "2027-02-17"],
    ]);
  });

  it("drops reminders on or after the nonpayment date", () => {
    const steps = mortgageeFollowUps(
      { dueDays: 30, reminderDays: [10, 20], offerDirectAfterDays: 5, nonpaymentAfterDays: 20 },
      date("2027-03-01"),
    );

    expect(steps.map((s) => s.id)).toEqual(["offer-direct", "remind-10", "nonpayment"]);
  });
});

describe("custom installment splits", () => {
  const split = [
    { dueOn: "2027-12-01", premium: "400.00" },
    { dueOn: "2028-06-01", premium: "600.01" },
  ];

  it("bills the split's amounts and due dates, with taxes spread over its count", () => {
    const schedule = buildSchedule(plan({ split, taxesFees: "spread" }), input("1000.01", "20"));

    expect(amounts(schedule.map((i) => i.premium))).toEqual(["400", "600.01"]);
    expect(schedule.map((i) => i.dueOn.toString())).toEqual(["2027-11-20", "2028-06-01"]);
    expect(schedule[1]!.issueOn.toString()).toBe("2028-05-18");
    expect(amounts(schedule.map((i) => i.taxesFees[0]!.amount))).toEqual(["10", "10"]);
  });

  it("refuses a split that doesn't add up to the premium", () => {
    expect(() => buildSchedule(plan({ split }), input("1000"))).toThrow(/add up/);
  });

  it("checks amounts, order, term and total", () => {
    const term = {
      premium: usd("1000.01"),
      termStart: date("2027-12-01"),
      termEnd: date("2028-12-01"),
    };

    expect(checkSplit(split, term)).toEqual([]);
    expect(checkSplit([], term)).toEqual(["Return at least one installment"]);
    expect(checkSplit([{ dueOn: "2027-12-01", premium: "1000.001" }], term)[0]).toMatch(/cents/);

    expect(checkSplit([{ dueOn: "2029-01-01", premium: "1000.01" }], term)[0]).toMatch(
      /after the term/,
    );

    expect(
      checkSplit(
        [
          { dueOn: "2028-06-01", premium: "500" },
          { dueOn: "2028-01-01", premium: "500.01" },
        ],
        term,
      )[0],
    ).toMatch(/before installment 1/);

    expect(checkSplit([{ dueOn: "2027-12-01", premium: "999" }], term)[0]).toMatch(/add up to 999/);
  });
});

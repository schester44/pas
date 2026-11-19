import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import {
  allocatePayment,
  netCredits,
  reversePayment,
  type StatementItem,
  statementAmounts,
  statementTotals,
} from "./agency-statement";
import { agingSteps, cutoffOnOrAfter } from "./statement-cycle";

const usd = (amount: string) => Money.of(amount, "USD");
const zero = usd("0");

const item = (
  id: string,
  gross: string,
  commission: string,
  basis: "gross" | "net" = "net",
): StatementItem => ({
  id,
  position: 0,
  invoiceId: `inv-${id}`,
  invoiceNumber: id,
  invoiceKind: gross.startsWith("-") ? "credit_note" : "invoice",
  policyId: "p",
  policyNumber: "P-1",
  insuredName: "Jordan",
  transactionId: `tx-${id}`,
  transactionType: gross.startsWith("-") ? "CANCELLATION" : "NEW_BUSINESS",
  effectiveDate: Temporal.PlainDate.from("2027-01-01"),
  ...statementAmounts(usd(gross), usd(commission), basis),
  credited: zero,
  paid: zero,
  settlementCredit: zero,
});

const json = (m: Money) => m.toString();

describe("account current statement", () => {
  it("totals gross, commission and net with returns, and nets returns against other items", () => {
    const items = netCredits([
      item("nb", "1200.00", "180.00"),
      item("end", "100.00", "15.00"),
      item("cxl", "-400.00", "-60.00"),
    ]);

    const totals = statementTotals(items, "USD");

    expect(json(totals.gross)).toBe("900");
    expect(json(totals.commission)).toBe("135");
    expect(json(totals.net)).toBe("765");
    expect(json(totals.due)).toBe("765");
    expect(json(totals.balance)).toBe("765");
    expect(items.map((i) => json(i.credited))).toEqual(["340", "0", "340"]);
  });

  it("owes the gross when the agency remits gross", () => {
    const totals = statementTotals(
      netCredits([item("nb", "1000", "150", "gross"), item("cxl", "-200", "-30", "gross")]),
      "USD",
    );

    expect(json(totals.due)).toBe("800");
    expect(json(totals.balance)).toBe("800");
  });

  it("applies a partial remittance oldest first and leaves the rest open", () => {
    const items = [item("a", "500", "75"), item("b", "300", "45"), item("c", "200", "30")];
    const { items: after, allocations } = allocatePayment(items, usd("600"));

    expect(allocations.map((a) => [a.itemId, json(a.amount), a.settled])).toEqual([
      ["a", "425", true],
      ["b", "175", false],
    ]);

    expect(json(statementTotals(after, "USD").balance)).toBe("250");
    expect(() => allocatePayment(after, usd("250.01"))).toThrow(/more than the statement/);
  });

  it("reverses the latest applications first and reopens those items", () => {
    const paid = allocatePayment(
      [item("a", "500", "75"), item("b", "300", "45")],
      usd("680"),
    ).items;

    const { items, reversals } = reversePayment(paid, usd("300"));

    expect(reversals.map((r) => [r.itemId, json(r.amount), r.settled])).toEqual([
      ["b", "255", true],
      ["a", "45", true],
    ]);

    expect(items.map((i) => json(i.paid))).toEqual(["380", "0"]);
    expect(json(statementTotals(items, "USD").balance)).toBe("300");
  });
});

const d = (s: string) => Temporal.PlainDate.from(s);

describe("statement cycle", () => {
  it("cuts off on the statement day, clamped to short months, or at month end", () => {
    expect(cutoffOnOrAfter(d("2027-01-10"), 25).toString()).toBe("2027-01-25");
    expect(cutoffOnOrAfter(d("2027-01-25"), 25).toString()).toBe("2027-01-25");
    expect(cutoffOnOrAfter(d("2027-01-26"), 25).toString()).toBe("2027-02-25");
    expect(cutoffOnOrAfter(d("2027-02-10"), 31).toString()).toBe("2027-02-28");
    expect(cutoffOnOrAfter(d("2027-04-03"), null).toString()).toBe("2027-04-30");
  });

  it("ages from the due date", () => {
    const steps = agingSteps(d("2027-03-02"), { reminderDays: 10, suspendAfterDays: 30 });

    expect(steps.map((s) => [s.action, s.on.toString()])).toEqual([
      ["past_due", "2027-03-03"],
      ["remind", "2027-03-12"],
      ["suspend", "2027-04-01"],
    ]);
  });
});

import { asId, type Clock, Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { Invoice } from "./invoice";

const clock = { now: () => Temporal.Instant.from("2028-01-01T00:00:00Z") } as Clock;
const usd = (amount: string) => Money.of(amount, "USD");

const installment = (scheduled: boolean) =>
  Invoice.issue(
    {
      tenantId: asId("t"),
      number: "INV-000002",
      policyId: "p",
      policyNumber: "POL-1",
      transactionId: "x",
      issuedOn: Temporal.PlainDate.from("2028-02-15"),
      dueOn: Temporal.PlainDate.from("2028-03-01"),
      scheduled,
      draft: { kind: "invoice", lines: [], total: usd("305") },
    },
    clock,
  );

describe("Invoice", () => {
  it("is paid once the balance reaches zero, and owed again when the payment reverses", () => {
    const invoice = installment(false);

    invoice.applyPayment(usd("100"), clock);
    expect(invoice.status).toBe("partially_paid");

    invoice.applyPayment(usd("205"), clock);
    expect(invoice.status).toBe("paid");

    invoice.reversePayment(usd("205"), clock);
    expect(invoice.status).toBe("partially_paid");
    expect(invoice.balance.toString()).toBe("205");
  });

  it("voids a scheduled installment fully settled by credit", () => {
    const invoice = installment(true);

    invoice.applyCredit(usd("305"), clock);
    expect(invoice.status).toBe("void");
    expect(invoice.balance.isZero()).toBe(true);
  });
});

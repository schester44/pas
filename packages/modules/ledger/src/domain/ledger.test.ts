import { asId, type Clock, Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { accountFor, receivableAccount } from "./accounts";
import { allocateOldestFirst, checkAllocations } from "./allocation";
import { collectedCommission, commissionBasisFor } from "./commission";
import { credit, debit, JournalEntry, totalsByCurrency } from "./journal";
import { matchLockboxRow, parseLockbox } from "./lockbox";
import { Payment } from "./payment";
import {
  applicationLines,
  chargeLines,
  creditRefundLines,
  negate,
  receiptLines,
  type Receivable,
  settlementLines,
  writeOffLines,
} from "./posting-rules";
import { reconcileReceivables } from "./reconciliation";
import { ageReceivables, trialBalance } from "./reports";
import { writeOffNeedsApproval } from "./write-off";

const clock = {
  now: () => Temporal.Instant.from("2028-03-01T12:00:00Z"),
  today: () => Temporal.PlainDate.from("2028-03-01"),
} as Clock;

const usd = (amount: string) => Money.of(amount, "USD");
const date = (value: string) => Temporal.PlainDate.from(value);
const tenantId = asId<"Tenant">("t");
const actor = { type: "system" as const, name: "Test" };

const invoice = (id: string, payerType: Receivable["payerType"] = "insured"): Receivable => ({
  invoiceId: id,
  number: `INV-${id}`,
  kind: "invoice",
  policyId: "pol",
  policyNumber: "POL-1",
  payerType,
  payerRef: payerType === "agency" ? "agency-1" : null,
  jurisdiction: "US-TX",
});

const draft = (lines: Parameters<typeof JournalEntry.draft>[0]["lines"]) =>
  JournalEntry.draft(
    {
      tenantId,
      key: "k",
      kind: "test",
      source: { type: "test", id: "1" },
      effectiveOn: date("2028-03-01"),
      actor,
      memo: "Test",
      lines,
    },
    clock,
  );

const sumOf = (lines: readonly { account: string; amount: Money }[], account: string) =>
  lines.filter((l) => l.account === account).reduce((t, l) => t.plus(l.amount), usd("0"));

const balanced = (lines: readonly { amount: Money }[]) =>
  [...totalsByCurrency(lines as never).values()].every((t) => t.isZero());

const receive = (amount: string) =>
  Payment.receive(
    {
      tenantId,
      number: "PMT-1",
      rail: "check",
      payer: { type: "agency", ref: "agency-1", name: "Acme Agency" },
      amount: usd(amount),
      receivedOn: date("2028-03-01"),
      reference: "Check 1001",
      provider: null,
      providerRef: null,
      batchId: null,
      memo: null,
    },
    clock,
  );

describe("journal entries", () => {
  it("must balance in every currency, at the cent", () => {
    expect(() => draft([debit("1000", usd("10")), credit("2000", usd("9.99"))])).toThrow(
      /differ by 0.01/,
    );

    expect(() => draft([debit("1000", usd("10.005")), credit("2000", usd("10.005"))])).toThrow(
      /cent/,
    );

    expect(() => draft([debit("1000", usd("10"))])).toThrow(/two lines/);

    expect(() =>
      draft([
        debit("1000", usd("10")),
        credit("2000", usd("10")),
        debit("1000", Money.of("5", "CAD")),
        credit("2000", Money.of("4", "CAD")),
      ]),
    ).toThrow(/CAD/);

    expect(draft([debit("1000", usd("10")), credit("2000", usd("10"))]).lines).toHaveLength(2);
  });

  it("are corrected only by a reversing entry that negates every line, once", () => {
    const original = draft([debit("1000", usd("10")), credit("2000", usd("10"))]);

    const reversal = original.reverse(
      { key: "k:reversal", effectiveOn: date("2028-03-02"), actor, memo: "Wrong account" },
      clock,
    );

    expect(reversal.toSnapshot().reversesId).toBe(original.id);
    expect(reversal.lines.map((l) => l.amount.toString())).toEqual(["-10", "10"]);

    expect(() =>
      reversal.reverse({ key: "x", effectiveOn: date("2028-03-02"), actor, memo: "" }, clock),
    ).toThrow();
  });
});

describe("posting rules", () => {
  const charges = [
    { kind: "written_premium" as const, code: "PREMIUM", amount: usd("1000") },
    { kind: "tax_fee" as const, code: "SL_TAX", amount: usd("48.50") },
    { kind: "installment_fee" as const, code: "FEE", amount: usd("5") },
  ];

  it("books an invoice to the payer's receivable against carrier, tax and fee accounts", () => {
    const lines = chargeLines(invoice("1"), charges, "USD");

    expect(balanced(lines)).toBe(true);
    expect(sumOf(lines, receivableAccount("insured")).toString()).toBe("1053.5");
    expect(sumOf(lines, accountFor("premium_payable")).toString()).toBe("-1000");
    expect(sumOf(lines, accountFor("taxes_fees_payable")).toString()).toBe("-48.5");

    expect(lines.find((l) => l.account === accountFor("taxes_fees_payable"))?.jurisdiction).toBe(
      "US-TX",
    );
  });

  it("credits the payer back for a credit note with the same rule", () => {
    const lines = chargeLines(
      { ...invoice("2"), kind: "credit_note" },
      charges.map((c) => ({ ...c, amount: c.amount.negated() })),
      "USD",
    );

    expect(balanced(lines)).toBe(true);
    expect(sumOf(lines, receivableAccount("insured")).toString()).toBe("-1053.5");
  });

  it("keeps every money movement balanced", () => {
    const payment = {
      id: "p1",
      rail: "check" as const,
      payer: { type: "agency" as const, ref: "a", name: null },
    };

    for (const lines of [
      receiptLines(payment, usd("100")),
      applicationLines(payment, invoice("1", "agency"), usd("60")),
      settlementLines(invoice("1", "agency"), usd("15")),
      writeOffLines(invoice("1"), usd("0.42")),
      creditRefundLines(invoice("2"), usd("20"), "check"),
      negate(applicationLines(payment, invoice("1", "agency"), usd("60"))),
    ]) {
      expect(balanced(lines)).toBe(true);
    }
  });
});

describe("cash application", () => {
  it("applies oldest due first and leaves an overpayment unapplied", () => {
    const items = [
      { invoiceId: "b", dueOn: date("2028-04-01"), balance: usd("100") },
      { invoiceId: "a", dueOn: date("2028-03-01"), balance: usd("100") },
      { invoiceId: "paid", dueOn: date("2028-02-01"), balance: usd("0") },
    ];

    const partial = allocateOldestFirst(usd("150"), items);

    expect(partial.allocations.map((a) => [a.invoiceId, a.amount.toString()])).toEqual([
      ["a", "100"],
      ["b", "50"],
    ]);

    expect(partial.remainder.isZero()).toBe(true);
    expect(allocateOldestFirst(usd("250"), items).remainder.toString()).toBe("50");
  });

  it("refuses a split that overpays an invoice or the payment", () => {
    const balances = new Map([
      ["a", usd("100")],
      ["b", usd("40")],
    ]);

    expect(() =>
      checkAllocations(usd("100"), [{ invoiceId: "b", amount: usd("40.01") }], balances),
    ).toThrow();

    expect(() =>
      checkAllocations(
        usd("100"),
        [
          { invoiceId: "a", amount: usd("70") },
          { invoiceId: "b", amount: usd("40") },
        ],
        balances,
      ),
    ).toThrow(/more than the 100 unapplied/);

    expect(() =>
      checkAllocations(usd("100"), [{ invoiceId: "a", amount: usd("100") }], balances),
    ).not.toThrow();
  });

  it("tracks a payment across partial application, unapply, NSF reversal and refunds", () => {
    const payment = receive("150");
    const first = payment.apply({ invoiceId: "a", policyId: "p", amount: usd("100") }, "e1", clock);

    expect(payment.toSnapshot().status).toBe("partially_applied");
    expect(payment.unapplied.toString()).toBe("50");

    expect(() =>
      payment.apply({ invoiceId: "b", policyId: "p", amount: usd("50.01") }, "e2", clock),
    ).toThrow();

    payment.unapply(first.id, clock);
    expect(payment.unapplied.toString()).toBe("150");

    payment.apply({ invoiceId: "a", policyId: "p", amount: usd("150") }, "e3", clock);
    expect(payment.toSnapshot().status).toBe("applied");

    const reversed = payment.reverse("Returned for insufficient funds", clock);

    expect(reversed.map((a) => a.eventId)).toEqual(["e3"]);
    expect(payment.toSnapshot().applied.isZero()).toBe(true);
    expect(payment.isReversed).toBe(true);

    expect(() =>
      payment.apply({ invoiceId: "a", policyId: "p", amount: usd("1") }, "e4", clock),
    ).toThrow();

    const refundable = receive("80");

    refundable.refund(usd("30"), clock);
    expect(refundable.unapplied.toString()).toBe("50");
    expect(() => refundable.refund(usd("50.01"), clock)).toThrow();
    expect(() => refundable.reverse("NSF", clock)).toThrow(/refunded/);
  });
});

describe("reports", () => {
  it("balances the trial balance when every entry balances", () => {
    const tb = trialBalance(
      [
        { code: "1000", name: "Cash", type: "asset", balance: usd("1053.5") },
        { code: "2100", name: "Premium payable", type: "liability", balance: usd("-1000") },
        { code: "2200", name: "Taxes payable", type: "liability", balance: usd("-53.5") },
      ],
      "USD",
    );

    expect(tb.balanced).toBe(true);
    expect(tb.debits.toString()).toBe("1053.5");
    expect(tb.rows[1]!.credit.toString()).toBe("1000");
  });

  it("ages receivables by days past due and keeps credits apart", () => {
    const [row] = ageReceivables(
      [
        { payerType: "agency", dueOn: date("2028-03-10"), balance: usd("10") },
        { payerType: "agency", dueOn: date("2028-02-20"), balance: usd("20") },
        { payerType: "agency", dueOn: date("2027-11-01"), balance: usd("30") },
        { payerType: "agency", dueOn: date("2028-01-01"), balance: usd("-5") },
      ],
      date("2028-03-01"),
      "USD",
    );

    expect(row!.buckets.current.toString()).toBe("10");
    expect(row!.buckets["1_30"].toString()).toBe("20");
    expect(row!.buckets.over_90.toString()).toBe("30");
    expect(row!.credits.toString()).toBe("-5");
    expect(row!.total.toString()).toBe("55");
  });
});

describe("reconciliation", () => {
  it("flags invoices whose ledger and PAS balances differ, or that only one side has", () => {
    const result = reconcileReceivables(
      new Map([
        ["a", { number: "INV-a", balance: usd("100") }],
        ["b", { number: "INV-b", balance: usd("50") }],
        ["c", { number: "INV-c", balance: usd("0") }],
      ]),
      [
        { invoiceId: "a", number: "INV-a", balance: usd("100") },
        { invoiceId: "b", number: "INV-b", balance: usd("40") },
        { invoiceId: "d", number: "INV-d", balance: usd("25") },
      ],
      "USD",
    );

    expect(result.differences.map((d) => [d.number, d.difference.toString()])).toEqual([
      ["INV-b", "10"],
      ["INV-d", "-25"],
    ]);

    expect(result.ledgerTotal.toString()).toBe("150");
    expect(result.pasTotal.toString()).toBe("165");
  });
});

describe("lockbox", () => {
  const csv = [
    "Deposit date,Amount,Check number,Payer,Invoice number,Statement number,Policy number",
    '2028-03-01,"1,250.00",5001,Acme Agency,,AC-00001,',
    "2028-03-01,100.00,5002,Pat Doe,INV-000007,,",
    "2028-03-01,75.00,5003,Unknown,,,POL-404",
    "2028-03-01,abc,5004,Bad row,,,",
  ].join("\n");

  it("parses rows by column name and matches invoice, then statement, then policy", () => {
    const rows = parseLockbox(csv, "USD", date("2028-03-01"));

    expect(rows.map((r) => r.amount?.toString() ?? null)).toEqual(["1250", "100", "75", null]);
    expect(rows[3]!.error).toMatch(/positive amount/);

    const candidates = [
      {
        invoiceId: "i7",
        number: "INV-000007",
        policyNumber: "POL-1",
        payerType: "insured" as const,
        payerRef: null,
        payerName: "Pat Doe",
        statementId: null,
        statementNumber: null,
        dueOn: date("2028-03-01"),
        balance: usd("100"),
      },
      {
        invoiceId: "i8",
        number: "INV-000008",
        policyNumber: "POL-2",
        payerType: "agency" as const,
        payerRef: "agency-1",
        payerName: "Acme Agency",
        statementId: "s1",
        statementNumber: "AC-00001",
        dueOn: date("2028-03-15"),
        balance: usd("1300"),
      },
    ];

    const [statement, direct, unmatched, bad] = rows.map((r) => matchLockboxRow(r, candidates));

    expect(statement).toMatchObject({ by: "statement", statementId: "s1" });
    expect(direct).toMatchObject({ by: "invoice", items: [{ invoiceId: "i7" }] });
    expect(unmatched).toMatchObject({ by: null, reason: "Nothing open for policy POL-404" });
    expect(bad?.by).toBeNull();
  });
});

describe("write-offs", () => {
  it("post at once at or under the small-balance threshold, otherwise wait for approval", () => {
    expect(writeOffNeedsApproval(usd("4.99"), usd("5"))).toBe(false);
    expect(writeOffNeedsApproval(usd("5"), usd("5"))).toBe(false);
    expect(writeOffNeedsApproval(usd("5.01"), usd("5"))).toBe(true);
    expect(writeOffNeedsApproval(usd("1"), null)).toBe(true);
  });
});

describe("commission basis", () => {
  it("follows the billing method unless the agency chose", () => {
    expect(commissionBasisFor(null, "agency")).toBe("written");
    expect(commissionBasisFor(null, "insured")).toBe("collected");
    expect(commissionBasisFor(null, "mortgagee")).toBe("collected");
    expect(commissionBasisFor("collected", "agency")).toBe("collected");
    expect(commissionBasisFor("written", "insured")).toBe("written");
  });

  it("pays collected-basis commission in proportion to what's collected, never more", () => {
    const at = (collected: string, charged = "1050") =>
      collectedCommission({
        commission: usd("100"),
        charged: usd(charged),
        collected: usd(collected),
      }).toString();

    expect(at("0")).toBe("0");
    expect(at("350")).toBe("33.33");
    expect(at("1050")).toBe("100");
    expect(at("1200")).toBe("100");
    expect(at("-50")).toBe("0");
    expect(at("100", "0")).toBe("0");
  });
});

import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { type Charge, invoiceFrom } from "./invoice-lines";

const charge = (kind: Charge["kind"], code: string, amount: string): Charge => ({
  kind,
  code,
  label: code,
  amount: Money.of(amount),
});

const cents = { places: 2, mode: "half_up" as const };

describe("invoiceFrom", () => {
  it("lists premium by coverage before taxes and totals the rounded lines", () => {
    const draft = invoiceFrom(
      [
        charge("tax_fee", "SL_TAX", "49.0700"),
        charge("written_premium", "dwelling", "1330"),
        charge("tax_fee", "STAMPING", "0.555"),
        charge("written_premium", "liability", "72"),
      ],
      "USD",
      cents,
    );

    expect(draft.lines.map((l) => [l.code, l.amount.toString()])).toEqual([
      ["dwelling", "1330"],
      ["liability", "72"],
      ["SL_TAX", "49.07"],
      ["STAMPING", "0.56"],
    ]);

    expect(draft.total.toString()).toBe("1451.63");
    expect(draft.kind).toBe("invoice");
  });

  it("makes a credit note for return premium and refuses mixed currencies", () => {
    const credit = invoiceFrom(
      [charge("written_premium", "dwelling", "-120.005"), charge("tax_fee", "SL_TAX", "-4.2")],
      "USD",
      cents,
    );

    expect(credit.kind).toBe("credit_note");
    expect(credit.total.toString()).toBe("-124.21");

    expect(() =>
      invoiceFrom([{ ...charge("tax_fee", "X", "1"), amount: Money.of("1", "EUR") }], "USD", cents),
    ).toThrow(/EUR/);
  });
});

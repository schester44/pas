import { Money, parseCsv, type PlainDate } from "@pas/kernel";
import type { PayerType } from "./accounts";
import type { OpenItem } from "./allocation";

export interface LockboxRow {
  row: number;
  raw: Record<string, string>;
  amount: Money | null;
  receivedOn: PlainDate | null;
  checkNumber: string | null;
  payerName: string | null;
  invoiceNumber: string | null;
  statementNumber: string | null;
  policyNumber: string | null;
  loanNumber: string | null;
  error: string | null;
}

const COLUMNS: Record<string, keyof LockboxRow> = {
  amount: "amount",
  amount_paid: "amount",
  date: "receivedOn",
  deposit_date: "receivedOn",
  received_on: "receivedOn",
  check_number: "checkNumber",
  check: "checkNumber",
  payer: "payerName",
  payer_name: "payerName",
  remitter: "payerName",
  invoice: "invoiceNumber",
  invoice_number: "invoiceNumber",
  statement: "statementNumber",
  statement_number: "statementNumber",
  policy: "policyNumber",
  policy_number: "policyNumber",
  loan: "loanNumber",
  loan_number: "loanNumber",
};

const headerKey = (cell: string) =>
  cell
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");

const AMOUNT = /^\d+(\.\d{1,2})?$/;

const text = (value: string | undefined) => value?.trim() || null;

/** A lockbox file: a header row, then one remittance per row. Columns are matched by name. */
export function parseLockbox(csv: string, currency: string, defaultDate: PlainDate): LockboxRow[] {
  const [header, ...body] = parseCsv(csv);

  if (!header) return [];

  const keys = header.map(headerKey);

  if (!keys.some((k) => COLUMNS[k] === "amount")) {
    throw new Error("The file needs an amount column");
  }

  return body.map((cells, index) => {
    const raw = Object.fromEntries(keys.map((k, i) => [k, cells[i]?.trim() ?? ""]));

    const field = (name: keyof LockboxRow) =>
      text(keys.map((k, i) => (COLUMNS[k] === name ? cells[i] : undefined)).find((v) => v?.trim()));

    const amountText = field("amount")?.replaceAll(/[$,]/g, "") ?? "";
    const dateText = field("receivedOn");
    let receivedOn: PlainDate | null = defaultDate;
    let error: string | null = null;

    try {
      if (dateText) receivedOn = Temporal.PlainDate.from(dateText);
    } catch {
      receivedOn = null;
      error = `“${dateText}” isn't a date (use YYYY-MM-DD)`;
    }

    const amount =
      AMOUNT.test(amountText) && Number(amountText) > 0 ? Money.of(amountText, currency) : null;

    if (!amount) error = `“${amountText}” isn't a positive amount`;

    return {
      row: index + 2,
      raw,
      amount,
      receivedOn,
      checkNumber: field("checkNumber"),
      payerName: field("payerName"),
      invoiceNumber: field("invoiceNumber"),
      statementNumber: field("statementNumber"),
      policyNumber: field("policyNumber"),
      loanNumber: field("loanNumber"),
      error,
    };
  });
}

export interface MatchCandidate extends OpenItem {
  number: string;
  policyNumber: string;
  payerType: PayerType;
  payerRef: string | null;
  payerName: string | null;
  statementId: string | null;
  statementNumber: string | null;
}

export type LockboxMatch =
  | {
      by: "invoice" | "statement" | "loan" | "policy";
      payer: { type: PayerType; ref: string | null; name: string | null };
      items: MatchCandidate[];
      statementId: string | null;
    }
  | { by: null; reason: string };

const open = (items: readonly MatchCandidate[]) =>
  items
    .filter((i) => i.balance.amount.greaterThan(0))
    .toSorted((a, b) => Temporal.PlainDate.compare(a.dueOn, b.dueOn));

const same = (a: string, b: string | null) => b !== null && a.toLowerCase() === b.toLowerCase();

/** Invoice number first, then statement, then loan number, then policy number. */
export function matchLockboxRow(
  row: LockboxRow,
  candidates: readonly MatchCandidate[],
): LockboxMatch {
  if (row.error || !row.amount) return { by: null, reason: row.error ?? "No amount" };

  const tries: [
    Exclude<LockboxMatch["by"], null>,
    string | null,
    (c: MatchCandidate, v: string) => boolean,
  ][] = [
    ["invoice", row.invoiceNumber, (c, v) => same(v, c.number)],
    ["statement", row.statementNumber, (c, v) => same(v, c.statementNumber)],
    ["loan", row.loanNumber, (c, v) => c.payerType === "mortgagee" && same(v, c.payerRef)],
    ["policy", row.policyNumber, (c, v) => same(v, c.policyNumber)],
  ];

  const named = tries.filter(([, value]) => value);

  if (named.length === 0)
    return { by: null, reason: "No invoice, statement, loan or policy number" };

  for (const [by, value, test] of named) {
    const items = open(candidates.filter((c) => test(c, value!)));

    if (items.length === 0) continue;

    const first = items[0]!;

    return {
      by,
      payer: { type: first.payerType, ref: first.payerRef, name: first.payerName },
      items: by === "invoice" ? items.slice(0, 1) : items,
      statementId: by === "statement" ? first.statementId : null,
    };
  }

  return {
    by: null,
    reason: `Nothing open for ${named.map(([by, value]) => `${by} ${value}`).join(", ")}`,
  };
}

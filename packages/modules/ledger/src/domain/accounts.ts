export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type AccountRole =
  | "cash_operating"
  | "card_clearing"
  | "ach_clearing"
  | "undeposited_funds"
  | "ar_insured"
  | "ar_agency"
  | "ar_mortgagee"
  | "unapplied_cash"
  | "premium_payable"
  | "taxes_fees_payable"
  | "commission_payable"
  | "refunds_payable"
  | "installment_fee_income"
  | "write_off_expense"
  | "opening_balances";

export interface AccountTemplate {
  code: string;
  name: string;
  type: AccountType;
  role: AccountRole;
}

/** The chart every tenant starts with; reports and posting rules find accounts by role. */
export const CHART_TEMPLATE: readonly AccountTemplate[] = [
  { code: "1000", name: "Cash, operating account", type: "asset", role: "cash_operating" },
  { code: "1010", name: "Card processor clearing", type: "asset", role: "card_clearing" },
  { code: "1020", name: "ACH clearing", type: "asset", role: "ach_clearing" },
  { code: "1030", name: "Undeposited funds", type: "asset", role: "undeposited_funds" },
  { code: "1200", name: "Accounts receivable, insureds", type: "asset", role: "ar_insured" },
  { code: "1210", name: "Accounts receivable, agencies", type: "asset", role: "ar_agency" },
  { code: "1220", name: "Accounts receivable, mortgagees", type: "asset", role: "ar_mortgagee" },
  { code: "2000", name: "Unapplied cash", type: "liability", role: "unapplied_cash" },
  { code: "2100", name: "Premium payable to carrier", type: "liability", role: "premium_payable" },
  { code: "2200", name: "Taxes and fees payable", type: "liability", role: "taxes_fees_payable" },
  { code: "2300", name: "Commission payable", type: "liability", role: "commission_payable" },
  { code: "2400", name: "Refunds payable", type: "liability", role: "refunds_payable" },
  { code: "3900", name: "Opening balances", type: "equity", role: "opening_balances" },
  {
    code: "4100",
    name: "Installment fee income",
    type: "income",
    role: "installment_fee_income",
  },
  { code: "6100", name: "Write-off expense", type: "expense", role: "write_off_expense" },
];

const BY_ROLE = new Map(CHART_TEMPLATE.map((a) => [a.role, a]));
const BY_CODE = new Map(CHART_TEMPLATE.map((a) => [a.code, a]));

export const accountFor = (role: AccountRole): string => BY_ROLE.get(role)!.code;

export const accountNamed = (code: string): AccountTemplate | undefined => BY_CODE.get(code);

/** Assets and expenses carry debit balances; liabilities, equity and income credit balances. */
export const isDebitNormal = (type: AccountType) => type === "asset" || type === "expense";

export type PayerType = "insured" | "agency" | "mortgagee";

export const PAYER_TYPES: readonly PayerType[] = ["insured", "agency", "mortgagee"];

const AR: Record<PayerType, AccountRole> = {
  insured: "ar_insured",
  agency: "ar_agency",
  mortgagee: "ar_mortgagee",
};

export const receivableAccount = (payer: PayerType): string => accountFor(AR[payer]);

export const RECEIVABLE_ACCOUNTS: readonly string[] = PAYER_TYPES.map(receivableAccount);

export const payerTypeOf = (value: string): PayerType =>
  value === "agency" || value === "mortgagee" ? value : "insured";

/** How money arrived. Cards and ACH debits settle through the processor; checks wait for deposit. */
export type Rail = "card" | "ach_debit" | "ach_push" | "wire" | "check" | "lockbox";

export const RAILS: readonly Rail[] = ["card", "ach_debit", "ach_push", "wire", "check", "lockbox"];

const RAIL_ACCOUNT: Record<Rail, AccountRole> = {
  card: "card_clearing",
  ach_debit: "ach_clearing",
  ach_push: "cash_operating",
  wire: "cash_operating",
  check: "undeposited_funds",
  lockbox: "undeposited_funds",
};

export const railAccount = (rail: Rail): string => accountFor(RAIL_ACCOUNT[rail]);

export const depositsInBatches = (rail: Rail) => RAIL_ACCOUNT[rail] === "undeposited_funds";

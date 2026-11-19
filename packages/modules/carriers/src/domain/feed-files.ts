import type { FeedFormat } from "./feed";

/** One issued transaction in a feed period. Amounts are decimal strings in `currency`. */
export interface FeedRecord {
  policyNumber: string;
  carrierPolicyNumber: string | null;
  transactionType: string;
  transactionId: string;
  effectiveDate: string;
  issuedOn: string;
  expirationDate: string;
  insuredName: string;
  jurisdiction: string;
  product: string;
  premiumChange: string;
  taxesFees: string;
  currency: string;
}

const COLUMNS: [keyof FeedRecord, string][] = [
  ["policyNumber", "Policy number"],
  ["carrierPolicyNumber", "Carrier policy number"],
  ["transactionType", "Transaction"],
  ["transactionId", "Transaction id"],
  ["effectiveDate", "Effective date"],
  ["expirationDate", "Expiration date"],
  ["issuedOn", "Issued on"],
  ["insuredName", "Insured"],
  ["jurisdiction", "Jurisdiction"],
  ["product", "Product"],
  ["premiumChange", "Premium"],
  ["taxesFees", "Taxes and fees"],
  ["currency", "Currency"],
];

const csvCell = (value: string | null) =>
  value === null ? "" : /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function bordereauxCsv(records: readonly FeedRecord[]): string {
  const header = COLUMNS.map(([, label]) => csvCell(label)).join(",");
  const rows = records.map((record) => COLUMNS.map(([key]) => csvCell(record[key])).join(","));

  return `${[header, ...rows].join("\r\n")}\r\n`;
}

const xml = (value: string | null) =>
  (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ACORD_TYPE: Record<string, string> = {
  NEW_BUSINESS: "NBS",
  ENDORSEMENT: "PCH",
  CANCELLATION: "XLN",
  CANCELLATION_RESCISSION: "RIX",
  REINSTATEMENT: "REI",
};

/** ACORD-style XML (policy transaction records); not a certified ACORD schema. */
export function acordXml(
  records: readonly FeedRecord[],
  header: { sender: string; carrier: string; period: { from: string; to: string } },
): string {
  const items = records.map(
    (r) => `  <PolicyTransaction>
    <BusinessPurposeTypeCd>${xml(ACORD_TYPE[r.transactionType] ?? r.transactionType)}</BusinessPurposeTypeCd>
    <TransactionId>${xml(r.transactionId)}</TransactionId>
    <PolicyNumber>${xml(r.policyNumber)}</PolicyNumber>
    <CarrierPolicyNumber>${xml(r.carrierPolicyNumber)}</CarrierPolicyNumber>
    <LOBDescription>${xml(r.product)}</LOBDescription>
    <StateProvCd>${xml(r.jurisdiction)}</StateProvCd>
    <InsuredName>${xml(r.insuredName)}</InsuredName>
    <EffectiveDt>${xml(r.effectiveDate)}</EffectiveDt>
    <ExpirationDt>${xml(r.expirationDate)}</ExpirationDt>
    <TransactionDt>${xml(r.issuedOn)}</TransactionDt>
    <WrittenAmt CurCd="${xml(r.currency)}">${xml(r.premiumChange)}</WrittenAmt>
    <TaxFeeAmt CurCd="${xml(r.currency)}">${xml(r.taxesFees)}</TaxFeeAmt>
  </PolicyTransaction>`,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<PolicyTransactionFeed sender="${xml(header.sender)}" carrier="${xml(header.carrier)}" from="${header.period.from}" to="${header.period.to}" count="${records.length}">
${items.join("\n")}
</PolicyTransactionFeed>
`;
}

export function feedFile(
  format: FeedFormat,
  records: readonly FeedRecord[],
  header: {
    sender: string;
    carrier: string;
    carrierKey: string;
    period: { from: string; to: string };
  },
): { fileName: string; contentType: string; body: string } {
  const stem = `${header.carrierKey}-${header.period.from}-${header.period.to}`;

  return format === "bordereaux_csv"
    ? { fileName: `${stem}-bordereaux.csv`, contentType: "text/csv", body: bordereauxCsv(records) }
    : {
        fileName: `${stem}-transactions.xml`,
        contentType: "application/xml",
        body: acordXml(records, header),
      };
}

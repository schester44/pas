import type { AddressValue, RiskSchema, SchemaNode } from "@pas/forms-core";
import { jurisdictionCode } from "@pas/kernel";
import type { TransactionType } from "./model";

export interface Jurisdiction {
  country: string;
  subdivision?: string;
}

export type CoverageAmount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

export interface MoneyValue {
  amount: string;
  currency: string;
}

export interface CoverageLike {
  code: string;
  name: string;
  attachesTo: { level: "policy" } | { level: "exposure"; path: string };
  required: boolean;
  limitOptions?: { options: CoverageAmount[]; defaultIndex: number };
  deductibleOptions?: { options: CoverageAmount[]; defaultIndex: number };
}

export interface SelectedCoverage {
  code: string;
  name: string;
  exposure?: { path: string; index: number };
  limit?: CoverageAmount;
  deductible?: CoverageAmount;
  premium?: MoneyValue;
}

export interface FormsScheduleRow {
  number: string;
  edition: string;
  title: string;
}

export interface Party {
  name: string;
  mailingAddress?: AddressValue;
}

export interface Producer {
  name: string;
  agency?: string;
  phone?: string;
  email?: string;
}

export interface DocumentContext {
  tenant: { name: string; primaryColor: string; supportEmail?: string; supportPhone?: string };
  carrier?: { name: string };
  product: { name: string; version: string };
  policy: {
    number?: string;
    effectiveDate: string;
    expirationDate: string;
    issuedDate: string;
    jurisdiction: Jurisdiction;
    jurisdictionName: string;
    transaction: TransactionType;
  };
  namedInsured: Party;
  producer?: Producer;
  risk: Record<string, unknown>;
  coverages: SelectedCoverage[];
  premium?: { total: MoneyValue };
  forms: FormsScheduleRow[];
  /** Set when rendering a notice (cancellation, rescission, reinstatement). */
  notice?: {
    title: string;
    reason: string;
    noticeDate: string;
    effectiveDate: string;
    minDaysNotice: number;
    returnPremium: MoneyValue;
  };
}

export interface ScheduleContext {
  jurisdiction: Jurisdiction;
  transaction: TransactionType;
  coverages: readonly string[];
  risk: Record<string, unknown>;
}

export function scheduleData(context: ScheduleContext): Record<string, unknown> {
  return {
    jurisdiction: jurisdictionCode(context.jurisdiction),
    country: context.jurisdiction.country,
    transaction: context.transaction,
    coverages: [...new Set(context.coverages)],
    risk: context.risk,
  };
}

export function scheduleContextOf(context: DocumentContext): ScheduleContext {
  return {
    jurisdiction: context.policy.jurisdiction,
    transaction: context.policy.transaction,
    coverages: context.coverages.map((coverage) => coverage.code),
    risk: context.risk,
  };
}

export function documentData(context: DocumentContext): Record<string, unknown> {
  return {
    ...scheduleData(scheduleContextOf(context)),
    tenant: context.tenant,
    carrier: context.carrier ?? {},
    product: context.product,
    policy: { ...context.policy, jurisdiction: context.policy.jurisdictionName },
    namedInsured: context.namedInsured,
    producer: context.producer ?? {},
    premium: context.premium ?? {},
    notice: context.notice ?? {},
  };
}

const field = (key: string, label: string, kind: SchemaNode["kind"] = "text"): SchemaNode =>
  ({ key, label, kind }) as SchemaNode;

const group = (key: string, label: string, children: SchemaNode[]): SchemaNode => ({
  key,
  label,
  kind: "group",
  children,
});

/** The paths merge fields, `showWhen` and `includeWhen` may read, described as a schema. */
export function contextSchema(risk: RiskSchema, scope: "document" | "schedule"): RiskSchema {
  const common: SchemaNode[] = [
    field("jurisdiction", "Jurisdiction code"),
    field("country", "Country code"),
    field("transaction", "Transaction type"),
    { key: "coverages", label: "Selected coverage codes", kind: "multi_enum", options: [] },
    group("risk", "Risk data", risk.fields),
  ];

  if (scope === "schedule") return { fields: common };

  return {
    fields: [
      ...common,
      group("tenant", "Organization", [
        field("name", "Organization name"),
        field("supportEmail", "Support email", "email"),
        field("supportPhone", "Support phone", "phone"),
      ]),
      group("carrier", "Carrier", [field("name", "Carrier name")]),
      group("product", "Product", [field("name", "Product name"), field("version", "Version")]),
      group("policy", "Policy", [
        field("number", "Policy number"),
        field("effectiveDate", "Effective date", "date"),
        field("expirationDate", "Expiration date", "date"),
        field("issuedDate", "Issued date", "date"),
        field("jurisdiction", "State"),
        field("transaction", "Transaction"),
      ]),
      group("namedInsured", "Named insured", [
        field("name", "Name"),
        field("mailingAddress", "Mailing address", "address"),
      ]),
      group("producer", "Producer", [
        field("name", "Producer name"),
        field("agency", "Agency"),
        field("phone", "Phone", "phone"),
        field("email", "Email", "email"),
      ]),
      group("premium", "Premium", [field("total", "Total premium", "money")]),
      group("notice", "Notice", [
        field("title", "Notice title"),
        field("reason", "Reason"),
        field("noticeDate", "Notice date", "date"),
        field("effectiveDate", "Cancellation effective date", "date"),
        field("minDaysNotice", "Days of notice", "integer"),
        field("returnPremium", "Return premium", "money"),
      ]),
    ],
  };
}

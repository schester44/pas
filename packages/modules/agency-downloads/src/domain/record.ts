import { isRecord, Money } from "@pas/kernel";
import { agencyCodeFor, type Enrollment } from "./enrollment";
import { acordCode, type DownloadSettings, type TransactionKind } from "./settings";

export interface MoneyValue {
  amount: string;
  currency: string;
}

export interface AddressValue {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

/** An issued transaction as policy administration reports it, before any download mapping. */
export interface DownloadTransactionView {
  policy: {
    id: string;
    number: string;
    productName: string;
    lineOfBusiness: string;
    insuredName: string;
    jurisdiction: { country: string; subdivision?: string };
    termEffectiveDate: string;
    termExpirationDate: string;
    billingMethod: string | null;
  };
  producer: { id: string; name: string; code: string | null };
  agency: { id: string; name: string };
  transaction: {
    id: string;
    type: string;
    effectiveDate: string;
    issuedAt: string;
    premium: MoneyValue;
    reason: string | null;
    changes: { label: string; before: unknown; after: unknown }[];
  };
  /** The written premium booked by this transaction, by coverage code. */
  premiumLines: { code: string; label: string; amount: MoneyValue }[];
  taxesFees: { code: string; label: string; amount: MoneyValue }[];
  /** The term version this transaction produced. */
  snapshot: Record<string, unknown>;
  documents: { id: string; kind: string; title: string }[];
}

export interface RecordCoverage {
  code: string;
  acordCode: string;
  name: string;
  locationRef: string | null;
  limit: MoneyValue | null;
  deductible: MoneyValue | null;
  termPremium: MoneyValue;
  transactionPremium: MoneyValue;
}

export interface RecordLocation {
  ref: string;
  address: AddressValue | null;
  attributes: Record<string, string | number | boolean>;
}

export interface RecordInterest {
  ref: string;
  kind: string;
  name: string;
  address: AddressValue | null;
  reference: string | null;
}

/** The canonical ACORD-shaped transaction every download format serializes (vendors.md §3). */
export interface DownloadRecord {
  version: 1;
  transaction: {
    id: string;
    kind: TransactionKind;
    type: string;
    effectiveDate: string;
    issuedAt: string;
    reason: string | null;
    changes: { label: string; before: string; after: string }[];
  };
  agency: { id: string; name: string; code: string | null; accountCode: string };
  producer: { id: string; name: string; code: string | null };
  insured: {
    name: string;
    givenName: string | null;
    surname: string | null;
    email: string | null;
    mailingAddress: AddressValue | null;
  };
  policy: {
    id: string;
    number: string;
    lob: string;
    acordLob: string;
    productName: string;
    country: string;
    subdivision: string | null;
    termEffectiveDate: string;
    termExpirationDate: string;
    billingMethod: string | null;
    termPremium: MoneyValue;
  };
  locations: RecordLocation[];
  coverages: RecordCoverage[];
  /** Premium booked by the transaction that belongs to no coverage, e.g. a minimum earned charge. */
  otherPremium: { code: string; label: string; amount: MoneyValue }[];
  taxesFees: { code: string; label: string; amount: MoneyValue }[];
  totals: { premium: MoneyValue; taxesFees: MoneyValue; total: MoneyValue };
  additionalInterests: RecordInterest[];
  documents: { id: string; kind: string; title: string }[];
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function addressOf(value: unknown): AddressValue | null {
  if (!isRecord(value)) return null;

  const line1 = text(value.line1);
  const city = text(value.city);

  if (!line1 || !city) return null;

  const line2 = text(value.line2);

  return {
    line1,
    ...(line2 && { line2 }),
    city,
    region: text(value.region) ?? "",
    postalCode: text(value.postalCode) ?? "",
    country: text(value.country) ?? "US",
  };
}

function moneyOf(value: unknown, currency: string): MoneyValue | null {
  if (!isRecord(value) || value.amount === undefined) return null;

  if (value.kind !== undefined && value.kind !== "money") return null;

  return Money.of(String(value.amount), text(value.currency) ?? currency).toJSON();
}

const sum = (amounts: readonly MoneyValue[], currency: string) =>
  amounts.reduce((total, a) => total.plus(Money.of(a.amount, a.currency)), Money.zero(currency));

const locationRef = (exposure: unknown) => {
  const match = typeof exposure === "string" ? /^locations\[(\d+)\]/.exec(exposure) : null;

  return match ? `L${Number(match[1]) + 1}` : null;
};

const display = (value: unknown) =>
  value === null || value === undefined
    ? ""
    : isRecord(value) && "amount" in value
      ? String(value.amount)
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

function locationsOf(risk: Record<string, unknown>): RecordLocation[] {
  const locations = Array.isArray(risk.locations) ? risk.locations : [];

  return locations.filter(isRecord).map((location, index) => ({
    ref: `L${index + 1}`,
    address: addressOf(location.address),
    attributes: Object.fromEntries(
      Object.entries(location).filter((entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1]),
      ),
    ),
  }));
}

function interestsOf(parties: Record<string, unknown>): RecordInterest[] {
  const interests = Array.isArray(parties.additionalInterests) ? parties.additionalInterests : [];

  return interests.filter(isRecord).map((interest, index) => ({
    ref: `AI${index + 1}`,
    kind: text(interest.kind) ?? "additional_interest",
    name: text(interest.name) ?? "",
    address: addressOf(interest.address),
    reference: text(interest.reference),
  }));
}

/**
 * Maps an issued transaction to the canonical record: the full policy image after the
 * transaction, plus what the transaction itself booked (premium by coverage, taxes and fees).
 */
export function toDownloadRecord(
  view: DownloadTransactionView,
  context: {
    kind: TransactionKind;
    enrollment: Pick<Enrollment, "accountCode" | "agencyCodes">;
    settings: Pick<DownloadSettings, "lobCodes" | "coverageCodes">;
  },
): DownloadRecord {
  const currency = view.transaction.premium.currency;
  const snapshot = view.snapshot;
  const risk = isRecord(snapshot.risk) ? snapshot.risk : {};
  const parties = isRecord(snapshot.parties) ? snapshot.parties : {};
  const insured = isRecord(risk.insured) ? risk.insured : {};
  const booked = new Map(view.premiumLines.map((line) => [line.code, line]));
  const zero = Money.zero(currency).toJSON();

  const coverages: RecordCoverage[] = (Array.isArray(snapshot.coverages) ? snapshot.coverages : [])
    .filter(isRecord)
    .map((coverage) => {
      const code = text(coverage.coverage) ?? "";

      return {
        code,
        acordCode: acordCode(context.settings.coverageCodes, code),
        name: text(coverage.name) ?? code,
        locationRef: locationRef(coverage.exposure),
        limit: moneyOf(coverage.limit, currency),
        deductible: moneyOf(coverage.deductible, currency),
        termPremium: moneyOf(coverage.premium, currency) ?? zero,
        transactionPremium: booked.get(code)?.amount ?? zero,
      };
    });

  const covered = new Set(coverages.map((c) => c.code));
  const otherPremium = view.premiumLines.filter((line) => !covered.has(line.code));

  const premium = sum(
    [...coverages.map((c) => c.transactionPremium), ...otherPremium.map((line) => line.amount)],
    currency,
  );

  const taxesFees = sum(
    view.taxesFees.map((t) => t.amount),
    currency,
  );

  const mailingAddress = addressOf(parties.mailingAddress) ?? addressOf(risk.mailingAddress);

  return {
    version: 1,
    transaction: {
      id: view.transaction.id,
      kind: context.kind,
      type: view.transaction.type,
      effectiveDate: view.transaction.effectiveDate,
      issuedAt: view.transaction.issuedAt,
      reason: view.transaction.reason,
      changes: view.transaction.changes.map((c) => ({
        label: c.label,
        before: display(c.before),
        after: display(c.after),
      })),
    },
    agency: {
      id: view.agency.id,
      name: view.agency.name,
      code: agencyCodeFor(context.enrollment),
      accountCode: context.enrollment.accountCode,
    },
    producer: view.producer,
    insured: {
      name: view.policy.insuredName,
      givenName: text(insured.firstName),
      surname: text(insured.lastName),
      email: text(insured.email),
      mailingAddress,
    },
    policy: {
      id: view.policy.id,
      number: view.policy.number,
      lob: view.policy.lineOfBusiness,
      acordLob: acordCode(context.settings.lobCodes, view.policy.lineOfBusiness),
      productName: view.policy.productName,
      country: view.policy.jurisdiction.country,
      subdivision: view.policy.jurisdiction.subdivision ?? null,
      termEffectiveDate: view.policy.termEffectiveDate,
      termExpirationDate: view.policy.termExpirationDate,
      billingMethod: view.policy.billingMethod,
      termPremium: moneyOf(snapshot.writtenPremium, currency) ?? zero,
    },
    locations: locationsOf(risk),
    coverages,
    otherPremium,
    taxesFees: view.taxesFees,
    totals: {
      premium: premium.toJSON(),
      taxesFees: taxesFees.toJSON(),
      total: premium.plus(taxesFees).toJSON(),
    },
    additionalInterests: interestsOf(parties),
    documents: view.documents,
  };
}

/** Why a record wouldn't reconcile with the books; empty when premium and totals agree. */
export function reconcile(record: DownloadRecord, booked: MoneyValue): string[] {
  const currency = booked.currency;
  const issues: string[] = [];

  const premium = sum(
    [
      ...record.coverages.map((c) => c.transactionPremium),
      ...record.otherPremium.map((p) => p.amount),
    ],
    currency,
  );

  if (!premium.equals(Money.of(booked.amount, currency))) {
    issues.push(`Premium by coverage ${premium.toString()} doesn't match ${booked.amount} booked`);
  }

  const taxes = sum(
    record.taxesFees.map((t) => t.amount),
    currency,
  );

  const total = Money.of(record.totals.total.amount, currency);

  if (!premium.plus(taxes).equals(total)) {
    issues.push(`Total ${total.toString()} isn't premium plus taxes and fees`);
  }

  return issues;
}

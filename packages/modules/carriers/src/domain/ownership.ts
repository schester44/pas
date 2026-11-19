import { isRecord, Money } from "@pas/kernel";
import type { Capability } from "./connector";
import type { CarrierChargeLine, CarrierPremiumLine } from "./outcome";

export const TRANSACTION_KINDS = [
  "new_business",
  "endorsement",
  "cancellation",
  "reinstatement",
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type TransactionOwner = "pas" | "carrier" | "carrier_with_mirror";
export type RatingOwner = "pas" | "carrier" | "pas_confirmed";
export type LineItemOwner = "pas" | "carrier";
export type DocumentSource = "tenant" | "carrier" | "both";
export type DocumentOrder = "tenant_first" | "carrier_first";
export type PolicyNumberOwner = "pas" | "carrier" | "both";
export type BillingOwner = "agency_bill" | "direct_bill";

/** Who owns each concern for one carrier × product (PLAN §12), set on the product version. */
export interface OwnershipMatrix {
  transactions: Record<TransactionKind, TransactionOwner>;
  rating: RatingOwner;
  lineItems: LineItemOwner;
  documents: { source: DocumentSource; order: DocumentOrder };
  policyNumber: PolicyNumberOwner;
  billing: BillingOwner;
}

/** `lifecycle.carrier` on a product version: which carrier writes it and who owns what. */
export interface CarrierAssignment {
  carrier: string;
  ownership: OwnershipMatrix;
}

export const PAS_OWNS_ALL: OwnershipMatrix = {
  transactions: {
    new_business: "pas",
    endorsement: "pas",
    cancellation: "pas",
    reinstatement: "pas",
  },
  rating: "pas",
  lineItems: "pas",
  documents: { source: "tenant", order: "tenant_first" },
  policyNumber: "pas",
  billing: "agency_bill",
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export function ownershipFrom(value: unknown): OwnershipMatrix {
  const source = isRecord(value) ? value : {};
  const transactions = isRecord(source.transactions) ? source.transactions : {};
  const documents = isRecord(source.documents) ? source.documents : {};
  const owners = ["pas", "carrier", "carrier_with_mirror"] as const;

  return {
    transactions: Object.fromEntries(
      TRANSACTION_KINDS.map((kind) => [kind, pick(transactions[kind], owners, "pas")]),
    ) as Record<TransactionKind, TransactionOwner>,
    rating: pick(source.rating, ["pas", "carrier", "pas_confirmed"], "pas"),
    lineItems: pick(source.lineItems, ["pas", "carrier"], "pas"),
    documents: {
      source: pick(documents.source, ["tenant", "carrier", "both"], "tenant"),
      order: pick(documents.order, ["tenant_first", "carrier_first"], "tenant_first"),
    },
    policyNumber: pick(source.policyNumber, ["pas", "carrier", "both"], "pas"),
    billing: pick(source.billing, ["agency_bill", "direct_bill"], "agency_bill"),
  };
}

export function carrierAssignmentOf(lifecycle: Record<string, unknown>): CarrierAssignment | null {
  const value = lifecycle.carrier;

  if (!isRecord(value) || typeof value.carrier !== "string" || !value.carrier) return null;

  return { carrier: value.carrier, ownership: ownershipFrom(value.ownership) };
}

/** Capabilities the carrier's gateway must implement for this ownership (a publish check). */
export function requiredCapabilities(ownership: OwnershipMatrix): Capability[] {
  const needed = new Set<Capability>();

  if (ownership.rating !== "pas") needed.add("quote");

  const { transactions } = ownership;

  if (transactions.new_business === "carrier") needed.add("bind").add("issue");

  if (transactions.endorsement === "carrier") needed.add("endorse");

  if (transactions.cancellation === "carrier") needed.add("cancel");

  if (transactions.reinstatement === "carrier") needed.add("reinstate");

  return [...needed];
}

export const delegates = (ownership: OwnershipMatrix, kind: TransactionKind) =>
  ownership.transactions[kind] === "carrier";

export interface FigureLine {
  key: string;
  label: string;
  amount: Money;
}

export interface FigureChange {
  key: string;
  label: string;
  pas: string | null;
  carrier: string | null;
  difference: string;
}

export interface FigureDiff {
  currency: string;
  changes: FigureChange[];
  pasTotal: string;
  carrierTotal: string;
  difference: string;
}

export const premiumKey = (line: { coverage: string; exposure?: string }) =>
  line.exposure ? `${line.coverage}@${line.exposure}` : line.coverage;

/**
 * "Carrier figures win": the carrier's lines replace ours, and the diff records every line that
 * moved, appeared or disappeared so the change can be explained. Unchanged lines aren't listed.
 */
export function reconcileFigures(
  pas: readonly FigureLine[],
  carrier: readonly FigureLine[],
  currency: string,
): { lines: FigureLine[]; diff: FigureDiff } {
  const ours = new Map(pas.map((line) => [line.key, line]));
  const theirs = new Map(carrier.map((line) => [line.key, line]));
  const keys = [...new Set([...ours.keys(), ...theirs.keys()])];
  const zero = Money.zero(currency);

  const changes = keys.flatMap((key): FigureChange[] => {
    const before = ours.get(key);
    const after = theirs.get(key);

    if (before && after && before.amount.equals(after.amount)) return [];

    return [
      {
        key,
        label: after?.label ?? before!.label,
        pas: before ? before.amount.toString() : null,
        carrier: after ? after.amount.toString() : null,
        difference: (after?.amount ?? zero).minus(before?.amount ?? zero).toString(),
      },
    ];
  });

  const total = (lines: readonly FigureLine[]) =>
    lines.reduce((sum, l) => sum.plus(l.amount), zero);

  const pasTotal = total(pas);
  const carrierTotal = total(carrier);

  return {
    lines: [...carrier],
    diff: {
      currency,
      changes,
      pasTotal: pasTotal.toString(),
      carrierTotal: carrierTotal.toString(),
      difference: carrierTotal.minus(pasTotal).toString(),
    },
  };
}

export function premiumFigures(
  lines: readonly CarrierPremiumLine[],
  currency: string,
  label: (line: CarrierPremiumLine) => string,
): FigureLine[] {
  return lines.map((line) => ({
    key: premiumKey(line),
    label: label(line),
    amount: Money.of(line.amount, currency),
  }));
}

export function chargeFigures(lines: readonly CarrierChargeLine[], currency: string): FigureLine[] {
  return lines.map((line) => ({
    key: line.code,
    label: line.label,
    amount: Money.of(line.amount, currency),
  }));
}

import { conflict, type Instant, Money, type PlainDate } from "@pas/kernel";
import type { TimelineActor } from "./policy-event";
import type { FeeLine, MinimumEarned, PremiumChange, RetainedLine } from "./proration";

export type TransactionType =
  | "NEW_BUSINESS"
  | "ENDORSEMENT"
  | "CANCELLATION"
  | "CANCELLATION_RESCISSION"
  | "REINSTATEMENT";

/**
 * `scheduled` holds a cancellation between its notice and its effective date; `pending_carrier`
 * holds a carrier-owned change until the carrier confirms it (PLAN §12).
 */
export type TransactionStatus =
  | "draft"
  | "quoted"
  | "pending_approval"
  | "pending_carrier"
  | "scheduled"
  | "issued"
  | "discarded";

const TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  draft: ["quoted", "discarded"],
  quoted: ["quoted", "pending_approval", "pending_carrier", "scheduled", "issued", "discarded"],
  pending_approval: ["quoted", "pending_carrier", "scheduled", "issued", "discarded"],
  pending_carrier: ["quoted", "scheduled", "issued", "discarded"],
  scheduled: ["issued", "discarded"],
  issued: [],
  discarded: [],
};

export const OPEN_STATUSES: readonly TransactionStatus[] = [
  "draft",
  "quoted",
  "pending_approval",
  "pending_carrier",
  "scheduled",
];

export function assertTransition(from: TransactionStatus, to: TransactionStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw conflict(`A ${from.replace("_", " ")} transaction can't become ${to.replace("_", " ")}`);
  }
}

export interface ReferralReason {
  reasonCode: string;
  message: string;
  outcome: string;
  authority?: string;
}

export interface FieldChange {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface CancellationDetails {
  reason: string;
  reasonLabel: string;
  initiator: string;
  method: "pro_rata";
  noticeDate: string;
  earliestDate: string;
  minDaysNotice: number;
  mailingDaysAdded: number;
  delivery: string;
  minimumEarned: {
    rule: MinimumEarned;
    minimum: Money;
    retained: Money;
    lines: RetainedLine[];
  } | null;
  fullyEarnedFees: string[];
}

/** Premium and taxes a change bills, by coverage. */
export interface Charges {
  premium: PremiumChange[];
  retained: RetainedLine[];
  fees: FeeLine[];
}

/** A later change the reroll re-applied over this one, where it disagrees or no longer fits. */
export interface RerollConflict {
  path: string;
  label: string;
  ours: unknown;
  theirs: unknown;
  outcome: "theirs_from_date" | "no_longer_applies";
}

/**
 * Out of sequence (PLAN §7.4): a later issued change, offset in full and re-applied on top of
 * this one, re-priced from its own effective date.
 */
export interface RerollSegment {
  transactionId: string;
  effectiveDate: string;
  label: string;
  reversed: Charges;
  reissued: Charges;
  after: Record<string, unknown>;
  changes: FieldChange[];
  conflicts: RerollConflict[];
}

/** What a non-issued transaction proposes, and what issuing it will write. */
export interface TransactionDetails {
  after: Record<string, unknown> | null;
  premium: PremiumChange[];
  retained: RetainedLine[];
  fees: FeeLine[];
  annualBefore: Money;
  annualAfter: Money;
  changes: FieldChange[];
  referrals: ReferralReason[];
  cancellation?: CancellationDetails;
  reinstatement?: { lapse: boolean; cancelledOn: string };
  note?: string;
  approvedBy?: TimelineActor;
  carrier?: CarrierHandling;
  reroll?: RerollSegment[];
  /** People-facing names of the exposure keys its lines use. */
  exposureLabels?: Record<string, string>;
}

/** The carrier's part in a delegated change: its run, reference and how its figures moved ours. */
export interface CarrierHandling {
  carrier: string;
  name: string;
  flowRunId: string;
  /** Each hand-off to the carrier is a new attempt with its own idempotency key. */
  attempt?: number;
  reference?: string;
  message?: string;
  diff?: {
    currency: string;
    changes: {
      key: string;
      label: string;
      pas: string | null;
      carrier: string | null;
      difference: string;
    }[];
    pasTotal: string;
    carrierTotal: string;
    difference: string;
  };
}

export interface PolicyTransactionProps {
  id: string;
  termId: string;
  type: TransactionType;
  status: TransactionStatus;
  effectiveDate: PlainDate;
  premiumDelta: Money;
  baseVersion: number;
  details: TransactionDetails | null;
  createdBy: TimelineActor | null;
  createdAt: Instant;
  updatedAt: Instant;
  issuedAt: Instant | null;
}

const chargeLines = (charges: Charges, prefix = "") => [
  ...charges.premium.map((line) => ({
    kind: "written_premium" as const,
    code: line.coverage,
    label: `${prefix}${line.name}`,
    coverage: line.coverage,
    ...(line.exposure !== undefined && { exposure: line.exposure }),
    amount: line.amount,
  })),
  ...charges.retained.map((line) => ({
    kind: "written_premium" as const,
    code: line.code ?? "MINIMUM_EARNED",
    label: `${prefix}${line.name}`,
    ...(line.coverage !== undefined && { coverage: line.coverage }),
    ...(line.exposure !== undefined && { exposure: line.exposure }),
    amount: line.amount,
  })),
  ...charges.fees.map((line) => ({
    kind: "tax_fee" as const,
    code: line.code,
    label: `${prefix}${line.label}`,
    remitter: line.remitter,
    amount: line.amount,
  })),
];

export type ChargeLine = ReturnType<typeof chargeLines>[number];

/**
 * The billable lines by effective date: the change's own, then for each rerolled later change
 * its offset and its re-priced lines on that change's date.
 */
export function chargesByDate(details: TransactionDetails): {
  effectiveDate: string | null;
  lines: ChargeLine[];
}[] {
  return [
    { effectiveDate: null, lines: chargeLines(details) },
    ...(details.reroll ?? []).map((segment) => ({
      effectiveDate: segment.effectiveDate,
      lines: [
        ...chargeLines(segment.reversed, `Offset of ${segment.label} · `),
        ...chargeLines(segment.reissued, `${capitalized(segment.label)} re-rated · `),
      ],
    })),
  ];
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The billable lines: prorated premium by coverage, minimum earned retained, then taxes and fees. */
export function chargesOf(details: TransactionDetails) {
  return chargesByDate(details).flatMap((group) => group.lines);
}

export function premiumOf(details: TransactionDetails, currency: string): Money {
  return chargesOf(details)
    .filter((line) => line.kind === "written_premium")
    .reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));
}

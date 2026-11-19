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

/** The billable lines: prorated premium by coverage, minimum earned retained, then taxes and fees. */
export function chargesOf(details: TransactionDetails) {
  return [
    ...details.premium.map((line) => ({
      kind: "written_premium" as const,
      code: line.coverage,
      label: line.name,
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      amount: line.amount,
    })),
    ...details.retained.map((line) => ({
      kind: "written_premium" as const,
      code: "MINIMUM_EARNED",
      label: line.name,
      ...(line.coverage !== undefined && { coverage: line.coverage }),
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      amount: line.amount,
    })),
    ...details.fees.map((line) => ({
      kind: "tax_fee" as const,
      code: line.code,
      label: line.label,
      remitter: line.remitter,
      amount: line.amount,
    })),
  ];
}

export function premiumOf(details: TransactionDetails, currency: string): Money {
  return chargesOf(details)
    .filter((line) => line.kind === "written_premium")
    .reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));
}

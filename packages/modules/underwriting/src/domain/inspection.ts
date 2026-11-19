import type { InspectionType, SubjectivityTiming } from "@pas/decisions-engine";
import {
  AggregateRoot,
  type Clock,
  conflict,
  type Id,
  type Instant,
  newId,
  type TenantId,
} from "@pas/kernel";
import type { Person } from "./referral";

export type InspectionId = Id<"Inspection">;

/** The normalized vendor flow (docs/research/vendors.md §2), then the underwriter's review. */
export const INSPECTION_STATUSES = [
  "requested",
  "ordered",
  "scheduled",
  "completed",
  "reviewed",
  "cancelled",
] as const;

export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export interface InspectionAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface InspectionFinding {
  code: string;
  label: string;
  severity: "info" | "minor" | "major";
  detail: string;
  /** Imagery findings can't be the only basis for a decline or non-renewal. */
  source: "onsite" | "imagery";
  recommendation?: { code: string; title: string; dueDays: number };
}

export interface InspectionPhoto {
  caption: string;
  url: string | null;
}

export interface InspectionReport {
  summary: string;
  findings: InspectionFinding[];
  photos: InspectionPhoto[];
}

export const REVIEW_OUTCOMES = ["satisfactory", "conditions", "field_inspection"] as const;

export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export interface InspectionReview {
  outcome: ReviewOutcome;
  note: string | null;
  by: Person;
  at: Instant;
  subjectivityCodes: string[];
}

export interface InspectionHistoryEntry {
  id: string;
  status: InspectionStatus;
  at: Instant;
  summary: string;
}

export interface InspectionProps {
  id: InspectionId;
  tenantId: TenantId;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  policyId: string | null;
  policyNumber: string | null;
  subjectivityId: string | null;
  code: string;
  type: InspectionType;
  timing: SubjectivityTiming;
  reason: string;
  address: InspectionAddress;
  providerId: string | null;
  providerRef: string | null;
  status: InspectionStatus;
  scheduledFor: Instant | null;
  completedAt: Instant | null;
  report: InspectionReport | null;
  review: InspectionReview | null;
  history: InspectionHistoryEntry[];
  createdAt: Instant;
  updatedAt: Instant;
}

export type NewInspection = Pick<
  InspectionProps,
  | "tenantId"
  | "quoteId"
  | "submissionId"
  | "submissionNumber"
  | "policyId"
  | "policyNumber"
  | "subjectivityId"
  | "code"
  | "type"
  | "timing"
  | "reason"
  | "address"
>;

export interface InspectionUpdate {
  status: "ordered" | "scheduled" | "completed" | "cancelled";
  scheduledFor?: Instant;
  completedAt?: Instant;
  report?: InspectionReport;
}

const ORDER: Record<InspectionStatus, number> = {
  requested: 0,
  ordered: 1,
  scheduled: 2,
  completed: 3,
  reviewed: 4,
  cancelled: 5,
};

const fmt = (i: Instant) => i.toString().slice(0, 10);

/** One property inspection, from order to the underwriter's review of the findings. */
export class Inspection extends AggregateRoot {
  private constructor(private props: InspectionProps) {
    super();
  }

  static request(input: NewInspection, clock: Clock): Inspection {
    const now = clock.now();

    const inspection = new Inspection({
      ...input,
      id: newId<"Inspection">(),
      providerId: null,
      providerRef: null,
      status: "requested",
      scheduledFor: null,
      completedAt: null,
      report: null,
      review: null,
      history: [],
      createdAt: now,
      updatedAt: now,
    });

    inspection.log("requested", `Requested: ${input.reason}`, now);
    inspection.event("underwriting.inspection_requested", now, {});

    return inspection;
  }

  static restore(props: InspectionProps): Inspection {
    return new Inspection(props);
  }

  get id(): InspectionId {
    return this.props.id;
  }

  get status(): InspectionStatus {
    return this.props.status;
  }

  /** Still waiting on the vendor. */
  get pending(): boolean {
    return ORDER[this.props.status] < ORDER.completed;
  }

  ordered(provider: { id: string; ref: string }, clock: Clock): void {
    if (this.props.status !== "requested") return;

    const now = clock.now();

    this.props = {
      ...this.props,
      providerId: provider.id,
      providerRef: provider.ref,
      status: "ordered",
      updatedAt: now,
    };

    this.log("ordered", `Ordered from ${provider.id}`, now);
    this.event("underwriting.inspection_ordered", now, { providerId: provider.id });
  }

  /** Applies what the vendor reports; stale or repeated updates are ignored. Returns what changed. */
  apply(update: InspectionUpdate, clock: Clock): InspectionStatus | null {
    if (ORDER[update.status] <= ORDER[this.props.status] || !this.pending) return null;

    const now = clock.now();

    this.props = {
      ...this.props,
      status: update.status,
      scheduledFor: update.scheduledFor ?? this.props.scheduledFor,
      completedAt: update.completedAt ?? this.props.completedAt,
      report: update.report ?? this.props.report,
      updatedAt: now,
    };

    if (update.status === "scheduled") {
      this.log(
        "scheduled",
        `Scheduled for ${update.scheduledFor ? fmt(update.scheduledFor) : "a date to confirm"}`,
        now,
      );

      this.event("underwriting.inspection_scheduled", now, {
        scheduledFor: update.scheduledFor?.toString() ?? null,
      });
    }

    if (update.status === "completed") {
      const findings = update.report?.findings ?? [];

      this.log("completed", `Completed with ${findings.length} findings; needs review`, now);

      this.event("underwriting.inspection_completed", now, {
        findings: findings.length,
        major: findings.filter((f) => f.severity === "major").length,
        imageryOnly: findings.length > 0 && findings.every((f) => f.source === "imagery"),
      });
    }

    if (update.status === "cancelled") this.log("cancelled", "Cancelled by the vendor", now);

    return update.status;
  }

  /** A person reviews every report; no outcome declines or non-renews by itself. */
  review(input: Omit<InspectionReview, "at">, clock: Clock): void {
    if (this.props.status !== "completed") {
      throw conflict(`The inspection is ${this.props.status}, so it can't be reviewed`, {
        reason: "invalid_status",
      });
    }

    const now = clock.now();

    this.props = {
      ...this.props,
      status: "reviewed",
      review: { ...input, at: now },
      updatedAt: now,
    };

    this.log("reviewed", `Reviewed by ${input.by.name}: ${input.outcome.replace("_", " ")}`, now);

    this.event("underwriting.inspection_reviewed", now, {
      outcome: input.outcome,
      by: input.by,
      subjectivityCodes: input.subjectivityCodes,
    });
  }

  /** Called off by us (the policy ended); returns false once it's no longer pending. */
  cancel(reason: string, clock: Clock): boolean {
    if (!this.pending) return false;

    const now = clock.now();

    this.props = { ...this.props, status: "cancelled", updatedAt: now };
    this.log("cancelled", `Cancelled: ${reason}`, now);
    this.event("underwriting.inspection_cancelled", now, { reason });

    return true;
  }

  linkPolicy(policy: { id: string; number: string }, clock: Clock): void {
    this.props = {
      ...this.props,
      policyId: policy.id,
      policyNumber: policy.number,
      updatedAt: clock.now(),
    };
  }

  toSnapshot(): Readonly<InspectionProps> {
    return { ...this.props };
  }

  private log(status: InspectionStatus, summary: string, at: Instant): void {
    this.props = {
      ...this.props,
      history: [...this.props.history, { id: newId(), status, at, summary }],
    };
  }

  private event(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    const s = this.props;

    this.record({
      id: newId(),
      type,
      tenantId: s.tenantId,
      aggregateType: "inspection",
      aggregateId: s.id,
      occurredAt,
      payload: {
        inspectionId: s.id,
        type: s.type,
        quoteId: s.quoteId,
        submissionId: s.submissionId,
        policyId: s.policyId,
        policyNumber: s.policyNumber,
        ...payload,
      },
    });
  }
}

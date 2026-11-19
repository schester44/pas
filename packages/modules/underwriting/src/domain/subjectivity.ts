import type { SubjectivityOwner, SubjectivityTiming } from "@pas/decisions-engine";
import {
  AggregateRoot,
  type Clock,
  conflict,
  type Id,
  type Instant,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import type { Person } from "./referral";

export type SubjectivityId = Id<"Subjectivity">;

export const SUBJECTIVITY_STATUSES = ["open", "received", "accepted", "waived"] as const;

export type SubjectivityStatus = (typeof SUBJECTIVITY_STATUSES)[number];

const TRANSITIONS: Record<SubjectivityStatus, readonly SubjectivityStatus[]> = {
  open: ["received", "accepted", "waived"],
  received: ["accepted", "waived", "open"],
  accepted: [],
  waived: [],
};

export const isCleared = (status: SubjectivityStatus) => TRANSITIONS[status].length === 0;

export type SubjectivitySource = "decision" | "underwriter" | "inspection";

/** Post-bind conditions fall due `dueDays` after the bind date; pre-bind ones are due before it. */
export function dueDateOf(
  timing: SubjectivityTiming,
  boundOn: PlainDate,
  dueDays: number | null,
): PlainDate | null {
  return timing === "post_bind" ? boundOn.add({ days: dueDays ?? 0 }) : null;
}

/** Only an open subjectivity is overdue: once something is received it waits on the underwriter. */
export function isOverdue(
  s: { status: SubjectivityStatus; dueDate: PlainDate | null },
  today: PlainDate,
): boolean {
  return (
    s.status === "open" && s.dueDate !== null && Temporal.PlainDate.compare(today, s.dueDate) > 0
  );
}

export interface SubjectivityDocument {
  key: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: Person;
  uploadedAt: Instant;
}

export interface SubjectivityHistoryEntry {
  id: string;
  type: "added" | "received" | "accepted" | "waived" | "reopened" | "activated" | "overdue";
  at: Instant;
  actor: Person;
  summary: string;
}

export interface SubjectivityProps {
  id: SubjectivityId;
  tenantId: TenantId;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  policyId: string | null;
  policyNumber: string | null;
  referralId: string | null;
  inspectionId: string | null;
  code: string;
  title: string;
  description: string | null;
  timing: SubjectivityTiming;
  dueDays: number | null;
  dueDate: PlainDate | null;
  owner: SubjectivityOwner;
  source: SubjectivitySource;
  consequence: string | null;
  status: SubjectivityStatus;
  documents: SubjectivityDocument[];
  history: SubjectivityHistoryEntry[];
  overdueAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export type NewSubjectivity = Pick<
  SubjectivityProps,
  | "tenantId"
  | "quoteId"
  | "submissionId"
  | "submissionNumber"
  | "policyId"
  | "policyNumber"
  | "referralId"
  | "inspectionId"
  | "code"
  | "title"
  | "description"
  | "timing"
  | "dueDays"
  | "owner"
  | "source"
  | "consequence"
>;

const SYSTEM: Person = { id: null, name: "Underwriting" };

/** A condition of the offer (PLAN §4 underwriting): met before binding, or within days after it. */
export class Subjectivity extends AggregateRoot {
  private constructor(private props: SubjectivityProps) {
    super();
  }

  static create(
    input: NewSubjectivity,
    by: Person,
    clock: Clock,
    boundOn?: PlainDate,
  ): Subjectivity {
    const now = clock.now();

    const subjectivity = new Subjectivity({
      ...input,
      id: newId<"Subjectivity">(),
      dueDate: boundOn ? dueDateOf(input.timing, boundOn, input.dueDays) : null,
      status: "open",
      documents: [],
      history: [],
      overdueAt: null,
      createdAt: now,
      updatedAt: now,
    });

    subjectivity.log("added", by, `${input.title} added`, now);
    subjectivity.event("underwriting.subjectivity_added", now, { source: input.source });

    if (boundOn) subjectivity.recordActivation(now);

    return subjectivity;
  }

  static restore(props: SubjectivityProps): Subjectivity {
    return new Subjectivity(props);
  }

  get id(): SubjectivityId {
    return this.props.id;
  }

  get status(): SubjectivityStatus {
    return this.props.status;
  }

  get isOpen(): boolean {
    return !isCleared(this.props.status);
  }

  /** Tracks the condition on the bound policy; post-bind conditions get their due date. */
  activate(policy: { id: string; number: string }, boundOn: PlainDate, clock: Clock): void {
    if (this.props.policyId) return;

    const now = clock.now();

    this.props = {
      ...this.props,
      policyId: policy.id,
      policyNumber: policy.number,
      dueDate: dueDateOf(this.props.timing, boundOn, this.props.dueDays),
      updatedAt: now,
    };

    this.recordActivation(now);
  }

  /** Decision-sourced conditions follow the latest quote while nothing has happened to them. */
  revise(
    input: Pick<
      SubjectivityProps,
      "title" | "description" | "dueDays" | "owner" | "consequence" | "timing"
    >,
    clock: Clock,
  ): void {
    this.props = { ...this.props, ...input, updatedAt: clock.now() };
  }

  receive(document: Omit<SubjectivityDocument, "uploadedAt">, clock: Clock): void {
    const now = clock.now();

    if (this.props.status === "open") this.move("received");
    else this.assertOpen();

    this.props = {
      ...this.props,
      documents: [...this.props.documents, { ...document, uploadedAt: now }],
      updatedAt: now,
    };

    this.log("received", document.uploadedBy, `${document.name} uploaded`, now);
    this.event("underwriting.subjectivity_received", now, { document: document.name });
  }

  accept(by: Person, note: string | null, clock: Clock): void {
    this.clear("accepted", by, note, clock);
  }

  waive(by: Person, reason: string, clock: Clock): void {
    this.clear("waived", by, reason, clock);
  }

  reopen(by: Person, note: string, clock: Clock): void {
    this.move("open");
    const now = clock.now();

    this.props = { ...this.props, updatedAt: now };
    this.log("reopened", by, `More needed: ${note}`, now);
  }

  /** True the first time the condition is found overdue; raises the configured consequence. */
  markOverdue(today: PlainDate, clock: Clock): boolean {
    if (this.props.overdueAt || !isOverdue(this.props, today)) return false;

    const now = clock.now();

    this.props = { ...this.props, overdueAt: now, updatedAt: now };
    this.log("overdue", SYSTEM, `${this.props.title} is overdue`, now);

    this.event("underwriting.subjectivity_overdue", now, {
      dueDate: this.props.dueDate?.toString(),
      consequence: this.props.consequence,
    });

    return true;
  }

  toSnapshot(): Readonly<SubjectivityProps> {
    return { ...this.props };
  }

  private recordActivation(now: Instant): void {
    if (this.props.timing !== "post_bind" || !this.props.dueDate) return;

    this.log("activated", SYSTEM, `Due ${this.props.dueDate.toString()}`, now);

    this.event("underwriting.subjectivity_activated", now, {
      dueDate: this.props.dueDate.toString(),
    });
  }

  private clear(to: "accepted" | "waived", by: Person, note: string | null, clock: Clock): void {
    this.move(to);
    const now = clock.now();

    this.props = { ...this.props, updatedAt: now };

    this.log(
      to,
      by,
      `${to === "accepted" ? "Accepted" : "Waived"} by ${by.name}${note ? `: ${note}` : ""}`,
      now,
    );

    this.event("underwriting.subjectivity_cleared", now, { status: to, by, note });
  }

  private move(to: SubjectivityStatus): void {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw conflict(`${this.props.title} is ${this.props.status}, so it can't be ${to}`, {
        reason: "invalid_status",
        status: this.props.status,
      });
    }

    this.props = { ...this.props, status: to };
  }

  private assertOpen(): void {
    if (!this.isOpen) {
      throw conflict(`${this.props.title} is already ${this.props.status}`, {
        reason: "invalid_status",
      });
    }
  }

  private log(type: SubjectivityHistoryEntry["type"], actor: Person, summary: string, at: Instant) {
    this.props = {
      ...this.props,
      history: [...this.props.history, { id: newId(), type, at, actor, summary }],
    };
  }

  private event(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    const s = this.props;

    this.record({
      id: newId(),
      type,
      tenantId: s.tenantId,
      aggregateType: "subjectivity",
      aggregateId: s.id,
      occurredAt,
      payload: {
        subjectivityId: s.id,
        code: s.code,
        title: s.title,
        quoteId: s.quoteId,
        submissionId: s.submissionId,
        policyId: s.policyId,
        policyNumber: s.policyNumber,
        ...payload,
      },
    });
  }
}

import type { ChannelKind, ObligationKind } from "@pas/decisions-engine";
import {
  AggregateRoot,
  type Clock,
  conflict,
  type DomainEvent,
  type Id,
  type Instant,
  invalid,
  type Jurisdiction,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import type { DueRule } from "./due-date";

export type ObligationId = Id<"Obligation">;

export const OBLIGATION_STATUSES = [
  "pending",
  "in_progress",
  "submitted",
  "accepted",
  "rejected",
  "corrected",
  "completed",
  "waived",
] as const;

export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

const TRANSITIONS: Record<ObligationStatus, readonly ObligationStatus[]> = {
  pending: ["in_progress", "submitted", "waived"],
  in_progress: ["submitted", "rejected", "waived"],
  submitted: ["accepted", "rejected"],
  accepted: ["completed"],
  rejected: ["corrected", "waived"],
  corrected: ["in_progress", "submitted", "waived"],
  completed: [],
  waived: [],
};

/** Statuses where the obligation still has to be met; only these can be overdue. */
export const OPEN_STATUSES: readonly ObligationStatus[] = [
  "pending",
  "in_progress",
  "rejected",
  "corrected",
];

export const canTransition = (from: ObligationStatus, to: ObligationStatus) =>
  TRANSITIONS[from].includes(to);

export type ResponsibleType = "licensee" | "tenant" | "agency" | "carrier";

export interface LicenseeRef {
  id: string;
  name: string;
  licenseNumber: string;
  jurisdiction: string;
}

export interface ResponsibleParty {
  type: ResponsibleType;
  name: string;
  licensee: LicenseeRef | null;
}

export interface ObligationSubject {
  type: "transaction" | "period";
  policyId: string | null;
  policyNumber: string | null;
  termId: string | null;
  transactionId: string | null;
  transactionType: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ObligationTimer {
  remindDays: number | null;
  escalateDays: number | null;
}

export type FilingStatus = "exported" | "submitted" | "accepted" | "rejected";

export interface FilingRecord {
  id: string;
  attempt: number;
  providerId: string;
  delivery: "api" | "file_export" | "manual";
  reference: string | null;
  batchId: string | null;
  status: FilingStatus;
  filingNumber: string | null;
  stampNumber: string | null;
  reasons: string[];
  submittedAt: Instant;
  respondedAt: Instant | null;
}

export interface ProofFile {
  key: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface ObligationProof {
  filingNumber: string | null;
  stampNumber: string | null;
  note: string | null;
  files: ProofFile[];
  recordedAt: Instant;
}

export interface Waiver {
  reason: string;
  approver: { id: string | null; name: string };
  waivedAt: Instant;
}

export interface ObligationActor {
  type: "user" | "system" | "channel";
  id?: string;
  name: string;
}

export type ObligationEventType =
  | "created"
  | "exported"
  | "submitted"
  | "accepted"
  | "rejected"
  | "corrected"
  | "completed"
  | "waived"
  | "reminded"
  | "overdue"
  | "escalated";

export interface ObligationEvent {
  id: string;
  type: ObligationEventType;
  occurredAt: Instant;
  actor: ObligationActor;
  summary: string;
  data: Record<string, unknown>;
}

export interface ObligationProps {
  id: ObligationId;
  tenantId: TenantId;
  dedupeKey: string;
  kind: ObligationKind;
  code: string;
  title: string;
  status: ObligationStatus;
  jurisdiction: Jurisdiction;
  subject: ObligationSubject;
  responsible: ResponsibleParty;
  channel: ChannelKind;
  rule: DueRule;
  timer: ObligationTimer;
  dueDate: PlainDate;
  lateFrom: Instant;
  escalation: number;
  data: Record<string, unknown>;
  source: { releaseId: string | null; decision: string };
  proof: ObligationProof | null;
  waiver: Waiver | null;
  filings: FilingRecord[];
  events: ObligationEvent[];
  createdAt: Instant;
  updatedAt: Instant;
  completedAt: Instant | null;
}

export type NewObligation = Omit<
  ObligationProps,
  | "id"
  | "status"
  | "escalation"
  | "proof"
  | "waiver"
  | "filings"
  | "events"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
>;

const formatDate = (date: PlainDate) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

const SYSTEM: ObligationActor = { type: "system", name: "Compliance" };

/** One regulatory or contractual duty: what is owed, by whom, by when and how it was met (PLAN §17.1). */
export class Obligation extends AggregateRoot {
  private readonly addedEvents: ObligationEvent[] = [];

  private constructor(private readonly props: ObligationProps) {
    super();
  }

  static create(input: NewObligation, clock: Clock): Obligation {
    const now = clock.now();

    const obligation = new Obligation({
      ...input,
      id: newId(),
      status: "pending",
      escalation: 0,
      proof: null,
      waiver: null,
      filings: [],
      events: [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });

    obligation.log("created", now, SYSTEM, `Due ${formatDate(input.dueDate)}`, {
      decision: input.source.decision,
    });

    obligation.emit("compliance.obligation_created", now, {});

    return obligation;
  }

  static restore(props: ObligationProps): Obligation {
    return new Obligation(props);
  }

  get id(): ObligationId {
    return this.props.id;
  }

  get status(): ObligationStatus {
    return this.props.status;
  }

  get isOpen(): boolean {
    return OPEN_STATUSES.includes(this.props.status);
  }

  isOverdue(now: Instant): boolean {
    return this.isOpen && Temporal.Instant.compare(now, this.props.lateFrom) >= 0;
  }

  get latestFiling(): FilingRecord | undefined {
    return this.props.filings.at(-1);
  }

  filing(filingId: string): FilingRecord {
    const filing = this.props.filings.find((f) => f.id === filingId);

    if (!filing) throw invalid(`Filing ${filingId} isn't on this obligation`);

    return filing;
  }

  /** A channel took the filing: an API now awaits its answer, a file export awaits upload. */
  recordSubmission(
    input: {
      providerId: string;
      delivery: FilingRecord["delivery"];
      reference: string | null;
      batchId?: string;
      actor: ObligationActor;
    },
    clock: Clock,
  ): FilingRecord {
    const exported = input.delivery === "file_export";
    const next = exported ? "in_progress" : "submitted";

    this.move(next);

    const now = clock.now();

    const filing: FilingRecord = {
      id: newId(),
      attempt: this.props.filings.length + 1,
      providerId: input.providerId,
      delivery: input.delivery,
      reference: input.reference,
      batchId: input.batchId ?? null,
      status: exported ? "exported" : "submitted",
      filingNumber: null,
      stampNumber: null,
      reasons: [],
      submittedAt: now,
      respondedAt: null,
    };

    this.props.filings.push(filing);

    this.log(
      exported ? "exported" : "submitted",
      now,
      input.actor,
      exported ? "Added to an export batch for upload" : `Submitted (attempt ${filing.attempt})`,
      { filingId: filing.id, providerId: input.providerId, reference: input.reference },
    );

    if (!exported) this.emit("compliance.filing_submitted", now, { filingId: filing.id });

    return filing;
  }

  /** Recorded by hand with proof, for portals and paper the system can't reach. */
  markSubmitted(
    input: { proof: Omit<ObligationProof, "recordedAt">; actor: ObligationActor },
    clock: Clock,
  ): void {
    const now = clock.now();
    const exported = this.props.status === "in_progress" ? this.latestFiling : undefined;

    if (exported?.status === "exported") {
      this.move("submitted");
      exported.status = "submitted";
      exported.submittedAt = now;
    } else {
      this.recordSubmission(
        { providerId: "manual", delivery: "manual", reference: null, actor: input.actor },
        clock,
      );
    }

    this.props.proof = { ...input.proof, recordedAt: now };

    this.log("submitted", now, input.actor, "Marked submitted with proof", {
      files: input.proof.files.map((f) => f.name),
      ...(input.proof.filingNumber && { filingNumber: input.proof.filingNumber }),
    });

    this.emit("compliance.filing_submitted", now, {
      filingId: this.latestFiling!.id,
      manual: true,
    });
  }

  accept(
    filingId: string,
    input: { filingNumber: string | null; stampNumber: string | null; actor: ObligationActor },
    clock: Clock,
  ): void {
    const filing = this.filing(filingId);

    if (filing.status === "accepted") return;

    this.move("accepted");

    const now = clock.now();

    filing.status = "accepted";
    filing.filingNumber = input.filingNumber;
    filing.stampNumber = input.stampNumber;
    filing.respondedAt = now;

    this.props.proof = {
      filingNumber: input.filingNumber,
      stampNumber: input.stampNumber,
      note: this.props.proof?.note ?? null,
      files: this.props.proof?.files ?? [],
      recordedAt: now,
    };

    this.log(
      "accepted",
      now,
      input.actor,
      input.filingNumber ? `Accepted as ${input.filingNumber}` : "Accepted",
      { filingId, filingNumber: input.filingNumber, stampNumber: input.stampNumber },
    );

    this.emit("compliance.filing_accepted", now, { filingId, filingNumber: input.filingNumber });
  }

  reject(
    filingId: string,
    input: { reasons: string[]; actor: ObligationActor },
    clock: Clock,
  ): void {
    const filing = this.filing(filingId);

    if (filing.status === "rejected") return;

    if (input.reasons.length === 0) throw invalid("Say why the filing was rejected");

    this.move("rejected");

    const now = clock.now();

    filing.status = "rejected";
    filing.reasons = input.reasons;
    filing.respondedAt = now;

    this.log("rejected", now, input.actor, `Rejected: ${input.reasons.join("; ")}`, {
      filingId,
      reasons: input.reasons,
    });

    this.emit("compliance.filing_rejected", now, { filingId, reasons: input.reasons });
  }

  /** The rejection is addressed; the obligation is ready to resubmit. */
  correct(
    input: { note: string; corrections: Record<string, unknown>; actor: ObligationActor },
    clock: Clock,
  ): void {
    if (!input.note.trim()) throw invalid("Describe the correction");

    this.move("corrected");

    const now = clock.now();

    this.props.data = { ...this.props.data, ...input.corrections };
    this.log("corrected", now, input.actor, input.note.trim(), { corrections: input.corrections });
  }

  /** Puts a licensee of record on an obligation created before one was set up for its state. */
  assignLicensee(licensee: LicenseeRef, actor: ObligationActor, clock: Clock): void {
    if (this.props.responsible.licensee || !this.isOpen) return;

    this.props.responsible = { type: "licensee", name: licensee.name, licensee };
    this.props.data = { ...this.props.data, licenseeMissing: false };

    this.log(
      "corrected",
      clock.now(),
      actor,
      `Licensee of record set to ${licensee.name} (${licensee.licenseNumber})`,
      {},
    );
  }

  complete(input: { actor: ObligationActor; summary: string }, clock: Clock): void {
    if (this.props.status === "completed") return;

    this.move("completed");

    const now = clock.now();

    this.props.completedAt = now;
    this.log("completed", now, input.actor, input.summary, {});
  }

  waive(
    input: { reason: string; approver: { id: string | null; name: string } },
    clock: Clock,
  ): void {
    if (!input.reason.trim()) throw invalid("Give the reason for the waiver");

    this.move("waived");

    const now = clock.now();

    this.props.waiver = { reason: input.reason.trim(), approver: input.approver, waivedAt: now };
    this.props.completedAt = now;

    this.log(
      "waived",
      now,
      {
        type: "user",
        ...(input.approver.id && { id: input.approver.id }),
        name: input.approver.name,
      },
      `Waived: ${input.reason.trim()}`,
      {},
    );

    this.emit("compliance.obligation_waived", now, {});
  }

  /**
   * The due-date timers (PLAN §17.1): 1 reminder before the deadline, 2 overdue, 3 escalated to a
   * manager. Each level fires once and only while the obligation is still open.
   */
  escalate(level: 1 | 2 | 3, clock: Clock): boolean {
    if (!this.isOpen || this.props.escalation >= level) return false;

    const now = clock.now();

    this.props.escalation = level;

    const due = formatDate(this.props.dueDate);

    if (level === 1) this.log("reminded", now, SYSTEM, `Due ${due}; nothing submitted yet`, {});

    if (level === 2) {
      this.log("overdue", now, SYSTEM, `Overdue since ${due}`, {});
      this.emit("compliance.obligation_overdue", now, {});
    }

    if (level === 3) {
      this.log("escalated", now, SYSTEM, "Escalated to the compliance manager", {});
      this.emit("compliance.obligation_escalated", now, {});
    }

    return true;
  }

  pullAddedEvents(): ObligationEvent[] {
    return this.addedEvents.splice(0);
  }

  toSnapshot(): Readonly<ObligationProps> {
    return this.props;
  }

  private move(to: ObligationStatus): void {
    const from = this.props.status;

    if (!canTransition(from, to)) {
      throw conflict(
        `Can't move a ${from.replace("_", " ")} obligation to ${to.replace("_", " ")}`,
        { from, to },
      );
    }

    this.props.status = to;
  }

  private log(
    type: ObligationEventType,
    occurredAt: Instant,
    actor: ObligationActor,
    summary: string,
    data: Record<string, unknown>,
  ): void {
    const event: ObligationEvent = { id: newId(), type, occurredAt, actor, summary, data };

    this.props.events.push(event);
    this.addedEvents.push(event);
    this.props.updatedAt = occurredAt;
  }

  private emit(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    const s = this.props;

    const event: DomainEvent = {
      id: newId(),
      type,
      tenantId: s.tenantId,
      aggregateType: "obligation",
      aggregateId: s.id,
      occurredAt,
      payload: {
        obligationId: s.id,
        kind: s.kind,
        status: s.status,
        policyId: s.subject.policyId,
        transactionId: s.subject.transactionId,
        ...payload,
      },
    };

    this.record(event);
  }
}

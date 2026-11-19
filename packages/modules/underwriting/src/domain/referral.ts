import {
  AggregateRoot,
  type Clock,
  conflict,
  DomainError,
  type Id,
  type Instant,
  type Jurisdiction,
  type Money,
  newId,
  type TenantId,
} from "@pas/kernel";

export type ReferralId = Id<"Referral">;

export const REFERRAL_STATUSES = [
  "open",
  "escalated",
  "info_requested",
  "approved",
  "declined",
  "closed",
] as const;

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

const TRANSITIONS: Record<ReferralStatus, readonly ReferralStatus[]> = {
  open: ["info_requested", "escalated", "approved", "declined", "closed"],
  escalated: ["info_requested", "approved", "declined", "closed"],
  info_requested: ["open", "escalated", "approved", "declined", "closed"],
  approved: [],
  declined: [],
  closed: [],
};

export const canTransition = (from: ReferralStatus, to: ReferralStatus) =>
  TRANSITIONS[from].includes(to);

export const isDecided = (status: ReferralStatus) => TRANSITIONS[status].length === 0;

export interface ReferralReason {
  reasonCode: string;
  message: string;
  outcome: "refer" | "decline" | "info_needed";
  authority?: string;
  internalMessage?: string;
  decision?: string;
  rule?: string;
}

export interface Person {
  id: string | null;
  name: string;
}

export interface Producer extends Person {
  agencyId: string | null;
}

export interface ReferralEntry {
  id: string;
  kind: "message" | "action";
  /** Producers see messages addressed to them and the outcome, never internal notes. */
  visibility: "producer" | "internal";
  author: Person & { role: "underwriter" | "producer" | "system" };
  action?: ReferralAction;
  body: string;
  data: Record<string, unknown>;
  at: Instant;
}

export type ReferralAction =
  | "opened"
  | "refreshed"
  | "assigned"
  | "info_requested"
  | "info_provided"
  | "escalated"
  | "approved"
  | "declined"
  | "closed";

export interface ReferralQuote {
  revision: number;
  reasons: ReferralReason[];
  writtenPremium: Money;
  total: Money;
  insuredValue: Money;
  dueAt: Instant;
}

export interface ReferralDecisionRecord {
  outcome: "approved" | "declined";
  by: Person;
  at: Instant;
  note: string | null;
  changes: Record<string, unknown>;
}

export interface ReferralProps {
  id: ReferralId;
  tenantId: TenantId;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  productId: string;
  productName: string;
  jurisdiction: Jurisdiction;
  insuredName: string | null;
  producer: Producer;
  status: ReferralStatus;
  quote: ReferralQuote;
  requiredLevel: number;
  assignee: Person | null;
  escalation: { level: number; problems: string[]; by: Person; at: Instant } | null;
  decision: ReferralDecisionRecord | null;
  entries: ReferralEntry[];
  openedAt: Instant;
  updatedAt: Instant;
}

export type NewReferral = Omit<
  ReferralProps,
  "id" | "status" | "assignee" | "escalation" | "decision" | "entries" | "openedAt" | "updatedAt"
>;

const SYSTEM = { id: null, name: "Underwriting rules", role: "system" as const };
const underwriter = (person: Person) => ({ ...person, role: "underwriter" as const });

/** A quote waiting on an underwriter (PLAN §11): reasons, queue position, conversation, decision. */
export class Referral extends AggregateRoot {
  private added: ReferralEntry[] = [];

  private constructor(private props: ReferralProps) {
    super();
  }

  static open(input: NewReferral, clock: Clock): Referral {
    const now = clock.now();

    const referral = new Referral({
      ...input,
      id: newId<"Referral">(),
      status: "open",
      assignee: null,
      escalation: null,
      decision: null,
      entries: [],
      openedAt: now,
      updatedAt: now,
    });

    referral.entry(
      "action",
      "internal",
      SYSTEM,
      `Referred: ${input.quote.reasons.map((r) => r.message).join("; ")}`,
      now,
      "opened",
      { reasonCodes: input.quote.reasons.map((r) => r.reasonCode) },
    );

    referral.event("underwriting.referral_created", now, {
      reasonCodes: input.quote.reasons.map((r) => r.reasonCode),
      requiredLevel: input.requiredLevel,
      dueAt: input.quote.dueAt.toString(),
    });

    return referral;
  }

  static restore(props: ReferralProps): Referral {
    return new Referral(props);
  }

  get id(): ReferralId {
    return this.props.id;
  }

  get status(): ReferralStatus {
    return this.props.status;
  }

  get isOpen(): boolean {
    return !isDecided(this.props.status);
  }

  /** The quote was referred again (requoted while under review): review the latest figures. */
  refresh(quote: ReferralQuote, requiredLevel: number, clock: Clock): void {
    this.assertOpen();
    const now = clock.now();

    this.props = {
      ...this.props,
      quote,
      requiredLevel: Math.max(requiredLevel, this.props.escalation?.level ?? 0),
      updatedAt: now,
    };

    this.entry("action", "internal", SYSTEM, "Requoted while under review", now, "refreshed", {
      revision: quote.revision,
      total: quote.total.toJSON(),
    });
  }

  assign(to: Person | null, by: Person, clock: Clock): void {
    this.assertOpen();
    const now = clock.now();

    this.props = { ...this.props, assignee: to, updatedAt: now };

    const summary = !to
      ? `${by.name} unassigned the referral`
      : to.id === by.id
        ? `${by.name} claimed the referral`
        : `${by.name} assigned the referral to ${to.name}`;

    this.entry("action", "internal", underwriter(by), summary, now, "assigned", {
      assignee: to,
    });
  }

  requestInfo(message: string, by: Person, clock: Clock): void {
    this.move("info_requested");
    const now = clock.now();

    this.props = { ...this.props, updatedAt: now };
    this.entry("message", "producer", underwriter(by), message, now, "info_requested", {});
    this.event("underwriting.info_requested", now, { message, by });
  }

  /** The producer's answer; a referral waiting on them goes back to the underwriters. */
  reply(message: string, producer: Person, clock: Clock): void {
    this.assertOpen();
    const now = clock.now();
    const answering = this.props.status === "info_requested";

    if (answering) this.move(this.props.escalation ? "escalated" : "open");

    this.props = { ...this.props, updatedAt: now };

    this.entry(
      "message",
      "producer",
      { ...producer, role: "producer" },
      message,
      now,
      answering ? "info_provided" : undefined,
      {},
    );

    if (answering) this.event("underwriting.info_provided", now, { by: producer });
  }

  note(message: string, by: Person, clock: Clock): void {
    this.entry("message", "internal", underwriter(by), message, clock.now(), undefined, {});
    this.props = { ...this.props, updatedAt: clock.now() };
  }

  /** Approval was beyond the underwriter's authority: it waits for someone at `level`. */
  escalate(
    input: { level: number; problems: string[]; by: Person; proposal?: Record<string, unknown> },
    clock: Clock,
  ): void {
    this.move("escalated");
    const now = clock.now();

    this.props = {
      ...this.props,
      requiredLevel: Math.max(this.props.requiredLevel, input.level),
      escalation: { level: input.level, problems: input.problems, by: input.by, at: now },
      assignee: null,
      updatedAt: now,
    };

    this.entry(
      "action",
      "internal",
      underwriter(input.by),
      `Escalated: ${input.problems.join("; ")}`,
      now,
      "escalated",
      { level: input.level, problems: input.problems, proposal: input.proposal ?? null },
    );

    this.event("underwriting.referral_escalated", now, {
      level: input.level,
      problems: input.problems,
      by: input.by,
    });
  }

  approve(
    input: { by: Person; level: number; note: string | null; changes: Record<string, unknown> },
    clock: Clock,
  ): void {
    if (input.level < this.props.requiredLevel) {
      throw new DomainError("forbidden", "This referral needs a higher underwriting authority", {
        reason: "authority",
        requiredLevel: this.props.requiredLevel,
      });
    }

    this.decide("approved", input, clock);
  }

  decline(
    input: { by: Person; note: string | null; changes: Record<string, unknown> },
    clock: Clock,
  ): void {
    this.decide("declined", input, clock);
  }

  /** The quote moved on without a decision (expired, withdrawn). */
  close(reason: string, clock: Clock): void {
    if (!this.isOpen) return;

    const now = clock.now();

    this.move("closed");
    this.props = { ...this.props, updatedAt: now };
    this.entry("action", "internal", SYSTEM, reason, now, "closed", {});
  }

  toSnapshot(): Readonly<ReferralProps> {
    return { ...this.props };
  }

  pullAdded(): ReferralEntry[] {
    const added = this.added;
    this.added = [];

    return added;
  }

  private decide(
    outcome: "approved" | "declined",
    input: { by: Person; note: string | null; changes: Record<string, unknown> },
    clock: Clock,
  ): void {
    this.move(outcome);
    const now = clock.now();
    const decision = { outcome, by: input.by, at: now, note: input.note, changes: input.changes };

    this.props = { ...this.props, decision, updatedAt: now };

    this.entry(
      "action",
      "producer",
      underwriter(input.by),
      `${outcome === "approved" ? "Approved" : "Declined"} by ${input.by.name}`,
      now,
      outcome,
      { note: input.note, ...input.changes },
    );

    this.event(`underwriting.referral_${outcome}`, now, {
      by: input.by,
      note: input.note,
      changes: input.changes,
    });
  }

  private move(to: ReferralStatus): void {
    if (!canTransition(this.props.status, to)) {
      throw conflict(
        `The referral is ${this.props.status.replace("_", " ")}, so it can't be ${to}`,
        {
          reason: "invalid_status",
          status: this.props.status,
        },
      );
    }

    this.props = { ...this.props, status: to };
  }

  private assertOpen(): void {
    if (!this.isOpen) {
      throw conflict(`The referral is already ${this.props.status}`, {
        reason: "invalid_status",
        status: this.props.status,
      });
    }
  }

  private entry(
    kind: ReferralEntry["kind"],
    visibility: ReferralEntry["visibility"],
    author: ReferralEntry["author"],
    body: string,
    at: Instant,
    action: ReferralAction | undefined,
    data: Record<string, unknown>,
  ): void {
    const entry: ReferralEntry = {
      id: newId(),
      kind,
      visibility,
      author,
      ...(action && { action }),
      body,
      data,
      at,
    };

    this.props = { ...this.props, entries: [...this.props.entries, entry] };
    this.added.push(entry);
  }

  private event(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "referral",
      aggregateId: this.props.id,
      occurredAt,
      payload: {
        referralId: this.props.id,
        quoteId: this.props.quoteId,
        submissionId: this.props.submissionId,
        submissionNumber: this.props.submissionNumber,
        ...payload,
      },
    });
  }
}

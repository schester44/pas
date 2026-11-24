import {
  AggregateRoot,
  canonicalJson,
  type Clock,
  conflict,
  formatMoney,
  type Id,
  type Instant,
  type Money,
  newId,
  type PlainDate,
  type TenantId,
  type UserId,
} from "@pas/kernel";
import type { Acknowledgement, BindDetails, CompletedBy } from "./bind-details";
import {
  awaitingCarrierPrice,
  type CarrierBindState,
  type CarrierQuoteResult,
  type CarrierQuoteState,
} from "./carrier-quote";
import {
  type ActivityActor,
  CATEGORY,
  type QuoteActivity,
  type QuoteActivityType,
  RULES_ACTOR,
} from "./quote-activity";
import { type BindRequirement, deriveBindRequirements } from "./bind-requirements";
import type { CoverageChoice } from "./coverages";
import type { PayPlanOffer } from "./pay-plan-offers";
import type { QuoteEvaluation } from "./quote-evaluation";
import type { SubmissionId } from "./submission";
import { outcomeOf, type UnderwritingReason } from "./underwriting";
import { NO_MODIFICATIONS, type ReferralModifications } from "./underwriter-terms";

export type QuoteId = Id<"Quote">;
export type QuoteStatus = "quoted" | "referred" | "declined" | "expired" | "bound";

export interface Underwriter {
  userId: UserId | null;
  name: string;
}

export interface ReferralDecision {
  outcome: "approved" | "declined";
  by: Underwriter;
  note?: string;
  conditions: string[];
  modifications?: ReferralModifications;
  declineReasons?: { code: string; message: string }[];
  adverseActionNotice?: string;
  decidedAt: Instant;
}

export interface ApprovalInput {
  by: Underwriter;
  note?: string;
  conditions: string[];
  modifications?: ReferralModifications;
}

export interface DeclineInput {
  by: Underwriter;
  note?: string;
  declineReasons?: { code: string; message: string }[];
  adverseActionNotice?: string;
}

export interface Referral {
  reasons: UnderwritingReason[];
  referredAt: Instant;
  reviewBy: Instant;
  decision: ReferralDecision | null;
}

export interface SignatureRecord {
  provider: string;
  envelopeId: string;
  signerName: string;
  signedAt: Instant;
  ipAddress: string;
  userAgent: string;
  consent: string;
  revision: number;
  documentKey: string;
  documentSha256: string;
  signer?: CompletedBy;
}

export interface PaymentRecord {
  paymentId: string;
  provider: string;
  amount: Money;
  brand: string;
  last4: string;
  capturedAt: Instant;
}

export interface QuoteProps {
  id: QuoteId;
  tenantId: TenantId;
  submissionId: SubmissionId;
  submissionNumber: string;
  productReleaseId: string;
  revision: number;
  status: QuoteStatus;
  termStart: PlainDate;
  termEnd: PlainDate;
  riskData: Record<string, unknown>;
  selection: CoverageChoice[];
  evaluation: QuoteEvaluation;
  approvedReasonCodes: string[];
  referral: Referral | null;
  details: BindDetails | null;
  signature: SignatureRecord | null;
  payment: PaymentRecord | null;
  payPlan: string | null;
  policy: { id: string; number: string } | null;
  expiresAt: Instant;
  createdAt: Instant;
  updatedAt: Instant;
  boundAt: Instant | null;
}

type Action = "requote" | "underwrite" | "expire" | "prepare" | "bind";

const ALLOWED_FROM: Record<Action, readonly QuoteStatus[]> = {
  requote: ["quoted"],
  underwrite: ["referred"],
  expire: ["quoted", "referred"],
  prepare: ["quoted"],
  bind: ["quoted"],
};

const VERB: Record<Action, string> = {
  requote: "changed",
  underwrite: "reviewed",
  expire: "expired",
  prepare: "prepared for binding",
  bind: "bound",
};

export interface QuoteTiming {
  expiresAt: Instant;
  reviewWithin: Temporal.Duration;
}

/** A priced offer on a submission and the journey to bind it (PLAN §7.2, §7.2.1). */
export class Quote extends AggregateRoot {
  private pendingActivity: QuoteActivity[] = [];

  private constructor(private props: QuoteProps) {
    super();
  }

  static create(
    input: {
      tenantId: TenantId;
      submissionId: SubmissionId;
      submissionNumber: string;
      productReleaseId: string;
      termStart: PlainDate;
      termEnd: PlainDate;
      riskData: Record<string, unknown>;
      selection: CoverageChoice[];
      evaluation: QuoteEvaluation;
      timing: QuoteTiming;
      actor: ActivityActor;
    },
    clock: Clock,
  ): Quote {
    const now = clock.now();

    const quote = new Quote({
      id: newId<"Quote">(),
      tenantId: input.tenantId,
      submissionId: input.submissionId,
      submissionNumber: input.submissionNumber,
      productReleaseId: input.productReleaseId,
      revision: 1,
      status: "quoted",
      termStart: input.termStart,
      termEnd: input.termEnd,
      riskData: input.riskData,
      selection: input.selection,
      evaluation: input.evaluation,
      approvedReasonCodes: [],
      referral: null,
      details: null,
      signature: null,
      payment: null,
      payPlan: null,
      policy: null,
      expiresAt: input.timing.expiresAt,
      createdAt: now,
      updatedAt: now,
      boundAt: null,
    });

    quote.settle(input.evaluation, input.timing.reviewWithin, now, input.actor, "Quoted");
    quote.recordEvent("submissions.quote_created", now, { status: quote.props.status });

    return quote;
  }

  static restore(props: QuoteProps): Quote {
    return new Quote(props);
  }

  get id(): QuoteId {
    return this.props.id;
  }

  get status(): QuoteStatus {
    return this.props.status;
  }

  /** The underwriter's terms from the last approval; they stay on every requote. */
  modifications(): ReferralModifications {
    const decision = this.props.referral?.decision;

    return decision?.outcome === "approved"
      ? (decision.modifications ?? NO_MODIFICATIONS)
      : NO_MODIFICATIONS;
  }

  isExpiredAt(now: Instant): boolean {
    return Temporal.Instant.compare(now, this.props.expiresAt) >= 0;
  }

  /** The chosen pay plan, else the default; null when the release offers no plans. */
  selectedPayPlan(): PayPlanOffer | null {
    const offers = this.props.evaluation.payPlans;

    return (
      offers.find((o) => o.key === this.props.payPlan) ??
      offers.find((o) => o.isDefault) ??
      offers[0] ??
      null
    );
  }

  choosePayPlan(key: string, clock: Clock): void {
    this.guard("prepare", clock);

    if (!this.props.evaluation.payPlans.some((o) => o.key === key)) {
      throw conflict("That pay plan isn't offered on this quote", {
        reason: "pay_plan_unavailable",
      });
    }

    this.props = { ...this.props, payPlan: key, updatedAt: clock.now() };
  }

  requirements(): BindRequirement[] {
    const { evaluation, details, signature, payment, revision } = this.props;

    const carrier = evaluation.carrier;

    return deriveBindRequirements({
      diligentSearch: evaluation.diligentSearch,
      attestations: evaluation.attestations,
      details,
      signed: signature?.revision === revision,
      paid: payment !== null,
      carrier: carrier && { name: carrier.name, quoted: carrier.status === "quoted" },
    });
  }

  requote(
    selection: CoverageChoice[],
    evaluation: QuoteEvaluation,
    reviewWithin: Temporal.Duration,
    actor: ActivityActor,
    clock: Clock,
  ): void {
    this.guard("requote", clock);
    this.assertNotWithCarrier();
    const now = clock.now();

    this.props = {
      ...this.props,
      revision: this.props.revision + 1,
      selection,
      evaluation,
      signature: null,
      updatedAt: now,
    };

    this.settle(evaluation, reviewWithin, now, actor, "Requoted");
    this.recordEvent("submissions.quote_requoted", now, { status: this.props.status });
  }

  /** Bind-time re-check against current data and date. False when it no longer binds as quoted. */
  recheck(evaluation: QuoteEvaluation, reviewWithin: Temporal.Duration, clock: Clock): boolean {
    this.guard("bind", clock);
    const outcome = outcomeOf(evaluation.reasons, this.props.approvedReasonCodes);
    const repriced = !evaluation.total.equals(this.props.evaluation.total);

    if (outcome === "quoted" && !repriced) return true;

    const now = clock.now();

    this.props = {
      ...this.props,
      revision: this.props.revision + 1,
      evaluation,
      signature: null,
      updatedAt: now,
    };

    this.settle(evaluation, reviewWithin, now, RULES_ACTOR, "Repriced at the bind check");
    this.recordEvent("submissions.quote_requoted", now, { status: this.props.status });

    return false;
  }

  /**
   * The underwriter's approval. With modifications the caller re-rated the quote on them, so the
   * new evaluation replaces the old one and the producer signs again.
   */
  approve(
    decision: ApprovalInput,
    clock: Clock,
    rerated?: { selection: CoverageChoice[]; evaluation: QuoteEvaluation },
  ): void {
    this.guard("underwrite", clock);
    const now = clock.now();
    const referral = this.props.referral!;
    const codes = referral.reasons.map((reason) => reason.reasonCode);

    this.props = {
      ...this.props,
      ...(rerated && {
        revision: this.props.revision + 1,
        selection: rerated.selection,
        evaluation: rerated.evaluation,
        signature: null,
      }),
      status: "quoted",
      approvedReasonCodes: [...new Set([...this.props.approvedReasonCodes, ...codes])],
      referral: { ...referral, decision: { outcome: "approved", ...decision, decidedAt: now } },
      updatedAt: now,
    };

    this.recordEvent("submissions.quote_approved", now, {
      reasonCodes: codes,
      conditions: decision.conditions,
      modified: rerated !== undefined,
    });

    this.log("uw_approved", now, actorOf(decision.by), `Approved by ${decision.by.name}`, {
      reasonCodes: codes,
      conditions: decision.conditions,
      ...(decision.note && { note: decision.note }),
      ...(decision.modifications && { modifications: decision.modifications }),
      ...(rerated && { total: rerated.evaluation.total.toJSON() }),
    });
  }

  decline(decision: DeclineInput, clock: Clock): void {
    this.guard("underwrite", clock);
    const now = clock.now();
    const referral = this.props.referral!;

    this.props = {
      ...this.props,
      status: "declined",
      referral: {
        ...referral,
        decision: { outcome: "declined", ...decision, conditions: [], decidedAt: now },
      },
      updatedAt: now,
    };

    this.recordEvent("submissions.quote_declined", now, { by: "underwriter" });

    this.log("uw_declined", now, actorOf(decision.by), `Declined by ${decision.by.name}`, {
      ...(decision.note && { note: decision.note }),
      ...(decision.declineReasons && { reasons: decision.declineReasons }),
    });
  }

  /** Called by the quote timer; a no-op until the validity period has run out. */
  expire(clock: Clock): boolean {
    const now = clock.now();

    if (!ALLOWED_FROM.expire.includes(this.props.status) || !this.isExpiredAt(now)) return false;

    this.props = { ...this.props, status: "expired", updatedAt: now };
    this.recordEvent("submissions.quote_expired", now, {});
    this.log("expired", now, { type: "system", name: "Quote timer" }, "Quote expired", {});

    return true;
  }

  saveDetails(details: BindDetails, clock: Clock): void {
    this.guard("prepare", clock);

    if (canonicalJson(details) === canonicalJson(this.props.details)) return;

    this.props = { ...this.props, details, signature: null, updatedAt: clock.now() };
  }

  recordSignature(signature: Omit<SignatureRecord, "revision">, clock: Clock): void {
    this.guard("prepare", clock);

    this.props = {
      ...this.props,
      signature: { ...signature, revision: this.props.revision },
      updatedAt: clock.now(),
    };

    this.log(
      "signed",
      signature.signedAt,
      { type: "user", name: signature.signerName },
      `${signature.signerName} signed the application`,
      {
        provider: signature.provider,
        envelopeId: signature.envelopeId,
        revision: this.props.revision,
        ...(signature.signer && { party: signature.signer.party }),
      },
    );

    this.recordEvent("submissions.quote_signed", signature.signedAt, {
      revision: this.props.revision,
      signerName: signature.signerName,
      party: signature.signer?.party ?? "producer",
    });
  }

  /** The insured accepting offered disclosures on their own; earlier acceptances keep their time. */
  acceptDisclosures(codes: readonly string[], by: CompletedBy, clock: Clock): Acknowledgement[] {
    this.guard("prepare", clock);

    const details = this.props.details;

    if (!details) {
      throw conflict("The producer hasn't entered the policy details yet", {
        reason: "details_missing",
      });
    }

    const offered = new Set(this.props.evaluation.attestations.map((a) => a.code));
    const held = new Set(details.acknowledgements.map((a) => a.code));
    const now = clock.now();

    const added = [...new Set(codes)]
      .filter((code) => offered.has(code) && !held.has(code))
      .map((code) => ({ code, acceptedAt: now.toString(), by }));

    if (added.length === 0) return details.acknowledgements;

    this.props = {
      ...this.props,
      details: { ...details, acknowledgements: [...details.acknowledgements, ...added] },
      updatedAt: now,
    };

    this.log(
      "disclosures_accepted",
      now,
      { type: "user", ...(by.userId && { id: by.userId }), name: by.name },
      `${by.name} accepted ${added.length === 1 ? "a disclosure" : `${added.length} disclosures`}`,
      { codes: added.map((a) => a.code), party: by.party },
    );

    return this.props.details!.acknowledgements;
  }

  noteSentToClient(input: { email: string; by: ActivityActor }, clock: Clock): void {
    this.log("sent_to_client", clock.now(), input.by, `Sent to ${input.email} to complete`, {
      email: input.email,
    });
  }

  notePaymentFailed(
    reason: { code: string; message: string; last4: string },
    actor: ActivityActor,
    clock: Clock,
  ): void {
    this.log("payment_failed", clock.now(), actor, `Card ending ${reason.last4} was declined`, {
      code: reason.code,
      message: reason.message,
    });
  }

  /** Pre-bind history recorded by another context, e.g. an underwriter's request for information. */
  note(
    type: QuoteActivityType,
    actor: ActivityActor,
    summary: string,
    data: Record<string, unknown>,
    clock: Clock,
  ): void {
    this.log(type, clock.now(), actor, summary, data);
  }

  pullActivity(): QuoteActivity[] {
    const activity = this.pendingActivity;
    this.pendingActivity = [];

    return activity;
  }

  get carrier(): CarrierQuoteState | null {
    return this.props.evaluation.carrier ?? null;
  }

  /** The carrier's quote flow started for this revision. */
  carrierRequested(input: { name: string; flowRunId: string | null }, clock: Clock): void {
    const carrier = this.requireCarrier();

    const now = clock.now();

    this.setCarrier(
      { ...carrier, name: input.name, flowRunId: input.flowRunId, updatedAt: now.toString() },
      now,
    );
  }

  /**
   * The carrier answered. With a re-evaluation (the carrier's figures, or a price mismatch to
   * refer) the quote settles again on it; otherwise only the carrier's state changes.
   */
  applyCarrierQuote(
    result: CarrierQuoteResult,
    evaluation: QuoteEvaluation | null,
    reviewWithin: Temporal.Duration,
    clock: Clock,
  ): void {
    const carrier = this.requireCarrier();
    const now = clock.now();

    const state: CarrierQuoteState = {
      ...carrier,
      status: result.status,
      reference: result.reference ?? carrier.reference,
      messages: result.messages,
      price: result.price,
      updatedAt: now.toString(),
    };

    const next = { ...(evaluation ?? this.props.evaluation), carrier: state };

    this.props = { ...this.props, evaluation: next, updatedAt: now };

    const actor = { type: "system" as const, name: carrier.name };

    if (result.status === "quoted") {
      this.log("carrier_quoted", now, actor, `${carrier.name} quoted ${formatMoney(next.total)}`, {
        reference: result.reference,
      });

      if (evaluation) this.settle(next, reviewWithin, now, actor, "", { logQuoted: false });

      return;
    }

    const messages = result.messages.map((m) => m.text).join("; ");

    const verb = {
      referred: "referred the quote",
      declined: "declined the quote",
      failed: "couldn't quote",
    }[result.status];

    const type = {
      referred: "carrier_referred",
      declined: "carrier_declined",
      failed: "carrier_failed",
    }[result.status] as QuoteActivityType;

    this.log(type, now, actor, `${carrier.name} ${verb}${messages ? `: ${messages}` : ""}`, {
      reference: result.reference,
    });
  }

  /** A carrier-owned bind is with the carrier; nothing changes here until it answers. */
  submitToCarrier(
    state: Omit<CarrierBindState, "status" | "message" | "startedAt">,
    clock: Clock,
  ): void {
    this.guard("bind", clock);
    const carrier = this.requireCarrier();
    const now = clock.now();

    this.setCarrier(
      {
        ...carrier,
        bind: { ...state, status: "pending_carrier", message: null, startedAt: now.toString() },
        updatedAt: now.toString(),
      },
      now,
    );

    this.log(
      "carrier_submitted",
      now,
      { type: "system", name: carrier.name },
      `Sent to ${carrier.name} to ${state.phase}`,
      {
        flowRunId: state.flowRunId,
        phase: state.phase,
      },
    );
  }

  carrierIssued(clock: Clock): void {
    const carrier = this.requireCarrier();
    const now = clock.now();

    if (!carrier.bind) return;

    this.setCarrier(
      { ...carrier, bind: { ...carrier.bind, status: "issued" }, updatedAt: now.toString() },
      now,
    );
  }

  carrierFailed(message: string, clock: Clock): void {
    const carrier = this.requireCarrier();
    const now = clock.now();

    if (!carrier.bind) return;

    this.setCarrier(
      {
        ...carrier,
        bind: { ...carrier.bind, status: "failed", message },
        updatedAt: now.toString(),
      },
      now,
    );

    this.log(
      "carrier_failed",
      now,
      { type: "system", name: carrier.name },
      `${carrier.name} didn't bind: ${message}`,
      {
        flowRunId: carrier.bind.flowRunId,
      },
    );
  }

  markBound(
    input: { policy: { id: string; number: string }; payment: PaymentRecord | null },
    clock: Clock,
  ): void {
    this.guard("bind", clock);
    const now = clock.now();

    this.props = {
      ...this.props,
      status: "bound",
      policy: input.policy,
      payment: input.payment,
      updatedAt: now,
      boundAt: now,
    };

    this.recordEvent("submissions.quote_bound", now, {
      policyId: input.policy.id,
      policyNumber: input.policy.number,
    });
  }

  toSnapshot(): Readonly<QuoteProps> {
    return { ...this.props };
  }

  private settle(
    evaluation: QuoteEvaluation,
    reviewWithin: Temporal.Duration,
    now: Instant,
    actor: ActivityActor,
    verb: string,
    options: { logQuoted: boolean } = { logQuoted: true },
  ): void {
    const status = outcomeOf(evaluation.reasons, this.props.approvedReasonCodes);
    const previous = this.props.status;

    this.props = { ...this.props, status };

    if (status === "referred") {
      const open = evaluation.reasons.filter(
        (reason) => !this.props.approvedReasonCodes.includes(reason.reasonCode),
      );

      this.props.referral = {
        reasons: open,
        referredAt: now,
        reviewBy: now.add(reviewWithin),
        decision: null,
      };

      this.recordEvent("submissions.quote_referred", now, {
        reasonCodes: open.map((reason) => reason.reasonCode),
      });

      this.log("referred", now, RULES_ACTOR, `Referred: ${open.map((r) => r.message).join("; ")}`, {
        reasons: open.map(({ reasonCode, message }) => ({ reasonCode, message })),
      });
    }

    if (status === "declined" && previous !== "declined") {
      this.recordEvent("submissions.quote_declined", now, { by: "rules" });

      this.log("uw_declined", now, RULES_ACTOR, "Declined by the underwriting rules", {
        reasons: evaluation.reasons
          .filter((r) => r.outcome === "decline")
          .map(({ reasonCode, message }) => ({ reasonCode, message })),
      });
    }

    if (status === "quoted" && options.logQuoted) {
      const total = evaluation.total;
      const awaiting = awaitingCarrierPrice(evaluation.carrier);

      this.log(
        "quoted",
        now,
        actor,
        awaiting ? `${verb}; waiting for the carrier's price` : `${verb} at ${formatMoney(total)}`,
        { revision: this.props.revision, ...(!awaiting && { total: total.toJSON() }) },
      );
    }
  }

  private log(
    type: QuoteActivityType,
    occurredAt: Instant,
    actor: ActivityActor,
    summary: string,
    data: Record<string, unknown>,
  ): void {
    this.pendingActivity.push({
      id: newId(),
      type,
      category: CATEGORY[type],
      occurredAt,
      actor,
      summary,
      data,
    });
  }

  private requireCarrier(): CarrierQuoteState {
    const carrier = this.props.evaluation.carrier;

    if (!carrier) throw conflict(`Quote ${this.props.submissionNumber} has no carrier quote`);

    return carrier;
  }

  private setCarrier(carrier: CarrierQuoteState, now: Instant): void {
    this.props = {
      ...this.props,
      evaluation: { ...this.props.evaluation, carrier },
      updatedAt: now,
    };
  }

  private assertNotWithCarrier(): void {
    if (this.props.evaluation.carrier?.bind?.status === "pending_carrier") {
      throw conflict(
        `Quote ${this.props.submissionNumber} is with the carrier to bind; wait for its answer`,
        {
          reason: "pending_carrier",
        },
      );
    }
  }

  private guard(action: Action, clock: Clock): void {
    if (!ALLOWED_FROM[action].includes(this.props.status)) {
      throw conflict(
        `Quote ${this.props.submissionNumber} is ${this.props.status}, so it can't be ${VERB[action]}`,
        { reason: "invalid_status", status: this.props.status },
      );
    }

    if (action !== "underwrite" && action !== "expire" && this.isExpiredAt(clock.now())) {
      throw conflict(`Quote ${this.props.submissionNumber} expired; requote to continue`, {
        reason: "expired",
      });
    }
  }

  private recordEvent(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "quote",
      aggregateId: this.props.id,
      occurredAt,
      payload: { submissionId: this.props.submissionId, ...payload },
    });
  }
}

function actorOf(by: Underwriter): ActivityActor {
  return by.userId
    ? { type: "user", id: by.userId, name: by.name }
    : { type: "system", name: by.name };
}

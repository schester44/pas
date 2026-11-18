import {
  AggregateRoot,
  canonicalJson,
  type Clock,
  conflict,
  type Id,
  type Instant,
  type Money,
  newId,
  type PlainDate,
  type TenantId,
  type UserId,
} from "@pas/kernel";
import type { BindDetails } from "./bind-details";
import {
  type ActivityActor,
  CATEGORY,
  type QuoteActivity,
  type QuoteActivityType,
  RULES_ACTOR,
} from "./quote-activity";
import { type BindRequirement, deriveBindRequirements } from "./bind-requirements";
import type { CoverageChoice } from "./coverages";
import type { QuoteEvaluation } from "./quote-evaluation";
import type { SubmissionId } from "./submission";
import { outcomeOf, type UnderwritingReason } from "./underwriting";

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
  decidedAt: Instant;
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

  isExpiredAt(now: Instant): boolean {
    return Temporal.Instant.compare(now, this.props.expiresAt) >= 0;
  }

  requirements(): BindRequirement[] {
    const { evaluation, details, signature, payment, revision } = this.props;

    return deriveBindRequirements({
      diligentSearch: evaluation.diligentSearch,
      attestations: evaluation.attestations,
      details,
      signed: signature?.revision === revision,
      paid: payment !== null,
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

    return false;
  }

  approve(decision: { by: Underwriter; note?: string; conditions: string[] }, clock: Clock): void {
    this.guard("underwrite", clock);
    const now = clock.now();
    const referral = this.props.referral!;
    const codes = referral.reasons.map((reason) => reason.reasonCode);

    this.props = {
      ...this.props,
      status: "quoted",
      approvedReasonCodes: [...new Set([...this.props.approvedReasonCodes, ...codes])],
      referral: { ...referral, decision: { outcome: "approved", ...decision, decidedAt: now } },
      updatedAt: now,
    };

    this.recordEvent("submissions.quote_approved", now, {
      reasonCodes: codes,
      conditions: decision.conditions,
    });

    this.log("uw_approved", now, actorOf(decision.by), `Approved by ${decision.by.name}`, {
      reasonCodes: codes,
      conditions: decision.conditions,
      ...(decision.note && { note: decision.note }),
    });
  }

  decline(decision: { by: Underwriter; note?: string }, clock: Clock): void {
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
      },
    );
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

  pullActivity(): QuoteActivity[] {
    const activity = this.pendingActivity;
    this.pendingActivity = [];

    return activity;
  }

  markBound(
    input: { policy: { id: string; number: string }; payment: PaymentRecord },
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

    if (status === "quoted") {
      const total = evaluation.total;

      const amount = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: total.currency,
      });

      this.log("quoted", now, actor, `${verb} at ${amount.format(Number(total.toString()))}`, {
        revision: this.props.revision,
        total: total.toJSON(),
      });
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

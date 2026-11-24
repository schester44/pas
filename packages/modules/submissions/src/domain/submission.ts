import {
  AggregateRoot,
  type Clock,
  conflict,
  invalid,
  type Id,
  type Instant,
  type Jurisdiction,
  jurisdictionCode,
  newId,
  type PlainDate,
  type TenantId,
  type UserId,
} from "@pas/kernel";
import { SubmissionStatusError } from "./errors";
import { insuredNameOf } from "./insured";
import type { Candidate, QuoteOption, SelectionStrategy } from "./quote-options";

export type SubmissionId = Id<"Submission">;
export type SubmissionStatus = "draft" | "submitted" | "withdrawn";
export type SubmissionChannel = "agent";
export type SubmissionStage = "quote";
export type RiskData = Record<string, unknown>;

export interface PinnedRelease {
  productId: string;
  productReleaseId: string;
  productVersionId: string;
  productVersion: string;
  formKey: string;
}

export interface Producer {
  userId: UserId;
  name: string;
  agencyId: string | null;
}

export interface SubmissionOffering {
  id: string;
  selection: SelectionStrategy;
}

/**
 * The pinned product fields name the intake release until a quote option is chosen, then the
 * chosen release (PLAN §6.0). `intakeReleaseId` and `formKey` never change.
 */
export interface SubmissionProps extends PinnedRelease {
  id: SubmissionId;
  intakeReleaseId: string;
  offeringId: string | null;
  selection: SelectionStrategy | null;
  candidates: Candidate[];
  options: QuoteOption[];
  tenantId: TenantId;
  number: string;
  jurisdiction: Jurisdiction;
  effectiveDate: PlainDate;
  channel: SubmissionChannel;
  stage: SubmissionStage;
  producer: Producer;
  riskData: RiskData;
  insuredName: string | null;
  status: SubmissionStatus;
  createdAt: Instant;
  updatedAt: Instant;
  submittedAt: Instant | null;
  withdrawnAt: Instant | null;
}

type Action = "edit" | "submit" | "choose" | "withdraw";

const ALLOWED_FROM: Record<Action, readonly SubmissionStatus[]> = {
  edit: ["draft"],
  submit: ["draft"],
  choose: ["submitted"],
  withdraw: ["draft", "submitted"],
};

const PAST_TENSE: Record<Action, string> = {
  edit: "edited",
  submit: "submitted",
  choose: "given a quote option",
  withdraw: "withdrawn",
};

/**
 * New-business intake for one risk, started for an offering and pinned to its candidate releases
 * (PLAN §6.0, §7.2).
 */
export class Submission extends AggregateRoot {
  private constructor(private props: SubmissionProps) {
    super();
  }

  static start(
    input: {
      tenantId: TenantId;
      number: string;
      release: PinnedRelease;
      offering: SubmissionOffering | null;
      candidates: Candidate[];
      jurisdiction: Jurisdiction;
      effectiveDate: PlainDate;
      channel: SubmissionChannel;
      stage: SubmissionStage;
      producer: Producer;
    },
    clock: Clock,
  ): Submission {
    const now = clock.now();

    const submission = new Submission({
      id: newId<"Submission">(),
      tenantId: input.tenantId,
      number: input.number,
      ...input.release,
      intakeReleaseId: input.release.productReleaseId,
      offeringId: input.offering?.id ?? null,
      selection: input.offering?.selection ?? null,
      candidates: input.candidates,
      options: [],
      jurisdiction: input.jurisdiction,
      effectiveDate: input.effectiveDate,
      channel: input.channel,
      stage: input.stage,
      producer: input.producer,
      riskData: {},
      insuredName: null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      withdrawnAt: null,
    });

    submission.recordEvent("submissions.submission_created", now, {
      number: input.number,
      productId: input.release.productId,
      productReleaseId: input.release.productReleaseId,
      offeringId: input.offering?.id ?? null,
      candidateReleaseIds: input.candidates.map((c) => c.productReleaseId),
      jurisdiction: jurisdictionCode(input.jurisdiction),
      effectiveDate: input.effectiveDate.toString(),
      channel: input.channel,
      producerId: input.producer.userId,
    });

    return submission;
  }

  static restore(props: SubmissionProps): Submission {
    return new Submission(props);
  }

  get id(): SubmissionId {
    return this.props.id;
  }

  get status(): SubmissionStatus {
    return this.props.status;
  }

  get chosenOption(): QuoteOption | null {
    return this.props.options.find((o) => o.chosen) ?? null;
  }

  isProducedBy(userId: UserId): boolean {
    return this.props.producer.userId === userId;
  }

  saveDraft(riskData: RiskData, clock: Clock): void {
    this.guard("edit");
    this.props = { ...this.props, ...withRiskData(riskData), updatedAt: clock.now() };
  }

  /** `riskData` must already have passed the intake form's authoritative validation. */
  submit(riskData: RiskData, options: QuoteOption[], clock: Clock): void {
    this.guard("submit");
    const now = clock.now();

    this.props = {
      ...this.props,
      ...withRiskData(riskData),
      options: options.map((o) => ({ ...o, chosen: false })),
      status: "submitted",
      updatedAt: now,
      submittedAt: now,
    };

    this.recordEvent("submissions.submission_submitted", now, {
      number: this.props.number,
      productReleaseId: this.props.productReleaseId,
    });
  }

  /** Points the submission at the chosen option's release; binding follows that product. */
  choose(productReleaseId: string, clock: Clock): QuoteOption {
    this.guard("choose");

    if (this.chosenOption) {
      throw conflict(`${this.props.number} already has a quote`, { reason: "option_chosen" });
    }

    const option = this.props.options.find((o) => o.productReleaseId === productReleaseId);

    if (!option) throw invalid("That isn't one of this submission's quote options");

    const now = clock.now();

    this.props = {
      ...this.props,
      productId: option.productId,
      productReleaseId: option.productReleaseId,
      productVersionId: option.productVersionId,
      productVersion: option.productVersion,
      options: this.props.options.map((o) => ({ ...o, chosen: o === option })),
      updatedAt: now,
    };

    this.recordEvent("submissions.option_chosen", now, {
      number: this.props.number,
      productId: option.productId,
      productReleaseId: option.productReleaseId,
    });

    return { ...option, chosen: true };
  }

  withdraw(clock: Clock): void {
    this.guard("withdraw");
    const now = clock.now();
    this.props = { ...this.props, status: "withdrawn", updatedAt: now, withdrawnAt: now };
  }

  toSnapshot(): Readonly<SubmissionProps> {
    return {
      ...this.props,
      candidates: [...this.props.candidates],
      options: [...this.props.options],
    };
  }

  private guard(action: Action): void {
    if (!ALLOWED_FROM[action].includes(this.props.status)) {
      throw new SubmissionStatusError(this.props.number, this.props.status, PAST_TENSE[action]);
    }
  }

  private recordEvent(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "submission",
      aggregateId: this.props.id,
      occurredAt,
      payload,
    });
  }
}

function withRiskData(riskData: RiskData) {
  return { riskData, insuredName: insuredNameOf(riskData) };
}

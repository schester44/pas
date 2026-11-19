import {
  AggregateRoot,
  type Clock,
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

export interface SubmissionProps extends PinnedRelease {
  id: SubmissionId;
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

type Action = "edit" | "submit" | "withdraw";

const ALLOWED_FROM: Record<Action, readonly SubmissionStatus[]> = {
  edit: ["draft"],
  submit: ["draft"],
  withdraw: ["draft", "submitted"],
};

const PAST_TENSE: Record<Action, string> = {
  edit: "edited",
  submit: "submitted",
  withdraw: "withdrawn",
};

/** New-business intake for one risk, pinned to the ProductRelease it was started on (PLAN §7.2). */
export class Submission extends AggregateRoot {
  private constructor(private props: SubmissionProps) {
    super();
  }

  static start(
    input: {
      tenantId: TenantId;
      number: string;
      release: PinnedRelease;
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

  isProducedBy(userId: UserId): boolean {
    return this.props.producer.userId === userId;
  }

  saveDraft(riskData: RiskData, clock: Clock): void {
    this.guard("edit");
    this.props = { ...this.props, ...withRiskData(riskData), updatedAt: clock.now() };
  }

  /** `riskData` must already have passed the pinned form's authoritative validation. */
  submit(riskData: RiskData, clock: Clock): void {
    this.guard("submit");
    const now = clock.now();

    this.props = {
      ...this.props,
      ...withRiskData(riskData),
      status: "submitted",
      updatedAt: now,
      submittedAt: now,
    };

    this.recordEvent("submissions.submission_submitted", now, {
      number: this.props.number,
      productReleaseId: this.props.productReleaseId,
    });
  }

  withdraw(clock: Clock): void {
    this.guard("withdraw");
    const now = clock.now();
    this.props = { ...this.props, status: "withdrawn", updatedAt: now, withdrawnAt: now };
  }

  toSnapshot(): Readonly<SubmissionProps> {
    return { ...this.props };
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

import { addressesIn } from "@pas/addresses";
import type { DecisionResult } from "@pas/decisions-engine";
import { Money, type TenantContext } from "@pas/kernel";
import type {
  DecideReferral,
  GetQuote,
  GetSubmission,
  PreviewReferralApproval,
  ReferralModifications,
  StaffQuoteDto,
  SubmissionDto,
} from "@pas/submissions";
import type {
  QuoteDesk,
  QuoteFacts,
  RequiredInspection,
  UnderwriterTerms,
} from "../ports/quote-desk";

const STAFF = { kind: "tenant" } as const;

const modificationsOf = (terms: UnderwriterTerms): ReferralModifications => ({
  coverages: terms.coverages,
  adjustment: terms.adjustment,
});

function results<K extends "subjectivities" | "inspection_requirements">(
  quote: StaffQuoteDto,
  kind: K,
) {
  return quote.evaluation.decisions
    .filter((d) => d.kind === kind)
    .map((d) => d.result as DecisionResult<K>);
}

/** Underwriting's view of a quote, read through the submissions context's public use cases. */
export class SubmissionsQuoteDesk implements QuoteDesk {
  constructor(
    private readonly submissions: {
      get: GetSubmission;
      quote: GetQuote;
      /** Only the API decides referrals; the worker reads facts. */
      preview?: PreviewReferralApproval;
      decide?: DecideReferral;
    },
  ) {}

  private get decide(): DecideReferral {
    if (!this.submissions.decide)
      throw new Error("Referral decisions aren't wired in this process");

    return this.submissions.decide;
  }

  async facts(ctx: TenantContext, input: { submissionId: string }): Promise<QuoteFacts> {
    const [submission, quote] = await Promise.all([
      this.submissions.get(ctx, STAFF, { id: input.submissionId }),
      this.submissions.quote.forStaff(ctx, STAFF, input),
    ]);

    if (!quote) throw new Error(`Submission ${input.submissionId} has no quote`);

    return toFacts(submission, quote);
  }

  async preview(ctx: TenantContext, input: { submissionId: string; terms: UnderwriterTerms }) {
    if (!this.submissions.preview)
      throw new Error("Approval previews aren't wired in this process");

    const preview = await this.submissions.preview(ctx, STAFF, {
      submissionId: input.submissionId,
      modifications: modificationsOf(input.terms),
    });

    return {
      writtenPremium: Money.fromJSON(preview.writtenPremium),
      total: Money.fromJSON(preview.total),
      insuredValue: Money.fromJSON(preview.insuredValue),
    };
  }

  async approve(ctx: TenantContext, input: Parameters<QuoteDesk["approve"]>[1]): Promise<void> {
    await this.decide(ctx, STAFF, {
      submissionId: input.submissionId,
      outcome: "approve",
      underwriterName: input.underwriterName,
      ...(input.note && { note: input.note }),
      conditions: input.conditions,
      modifications: modificationsOf(input.terms),
    });
  }

  async decline(ctx: TenantContext, input: Parameters<QuoteDesk["decline"]>[1]): Promise<void> {
    await this.decide(ctx, STAFF, {
      submissionId: input.submissionId,
      outcome: "decline",
      underwriterName: input.underwriterName,
      ...(input.note && { note: input.note }),
      declineReasons: input.reasons,
      ...(input.adverseActionNotice && { adverseActionNotice: input.adverseActionNotice }),
    });
  }
}

function toFacts(submission: SubmissionDto, quote: StaffQuoteDto): QuoteFacts {
  const open = quote.status === "referred" && quote.referral ? quote.referral.reasons : null;

  const location = addressesIn(submission.riskSchema, submission.riskData).find(
    (a) => a.role === "location",
  )?.value;

  const inspections = new Map<string, RequiredInspection>();

  for (const result of results(quote, "inspection_requirements")) {
    for (const i of result.inspections) if (!inspections.has(i.type)) inspections.set(i.type, i);
  }

  return {
    quoteId: quote.id,
    submissionId: quote.submissionId,
    submissionNumber: quote.submissionNumber,
    status: quote.status,
    revision: quote.revision,
    productId: submission.productId,
    productName: submission.productName,
    jurisdiction: submission.jurisdiction,
    insuredName: submission.insuredName,
    producer: {
      id: submission.producer.id,
      name: submission.producer.name,
      agencyId: submission.producer.agencyId,
    },
    reasons: open ?? quote.evaluation.reasons,
    writtenPremium: Money.fromJSON(quote.premium.written),
    total: Money.fromJSON(quote.premium.total),
    insuredValue: Money.fromJSON(quote.insuredValue),
    reviewBy: quote.referral ? Temporal.Instant.from(quote.referral.reviewBy) : null,
    policy: quote.policy,
    boundAt: quote.boundAt ? Temporal.Instant.from(quote.boundAt) : null,
    subjectivities: results(quote, "subjectivities").flatMap((r) => r.subjectivities),
    inspections: [...inspections.values()],
    location: location
      ? {
          line1: location.line1,
          ...(location.line2 && { line2: location.line2 }),
          city: location.city,
          region: location.region,
          postalCode: location.postalCode,
          country: location.country,
        }
      : null,
  };
}

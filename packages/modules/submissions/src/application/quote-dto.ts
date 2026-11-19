import type { CoverageAmount } from "@pas/documents";
import type { Money } from "@pas/kernel";
import type { BindDetails } from "../domain/bind-details";
import type { BindRequirement } from "../domain/bind-requirements";
import type { CarrierQuoteState } from "../domain/carrier-quote";
import { exposuresOf } from "../domain/coverages";
import { exposureLabel, insuredNameOf, mailingAddressOf } from "../domain/insured";
import type { PayPlanOffer } from "../domain/pay-plan-offers";
import type { Quote } from "../domain/quote";
import type { DecisionRecord, RatingRecord } from "../domain/quote-evaluation";
import type { Submission } from "../domain/submission";
import type { UnderwritingReason } from "../domain/underwriting";
import { insuredValueOf, type ReferralModifications } from "../domain/underwriter-terms";
import { AUTOPAY_CONSENT, ESIGN_CONSENT } from "./esign-consent";

export interface MoneyDto {
  amount: string;
  currency: string;
}

const money = (value: Money): MoneyDto => value.toJSON();

export interface QuoteCoverageDto {
  code: string;
  name: string;
  description?: string;
  required: boolean;
  dependsOn: string[];
  level: "policy" | "exposure";
  limits: CoverageAmount[];
  deductibles: CoverageAmount[];
  defaultLimit: CoverageAmount | null;
  defaultDeductible: CoverageAmount | null;
  exposures: {
    exposure: string | null;
    label: string | null;
    selected: boolean;
    limit: CoverageAmount | null;
    deductible: CoverageAmount | null;
    premium: MoneyDto | null;
  }[];
}

export interface ReasonDto {
  reasonCode: string;
  message: string;
  outcome: UnderwritingReason["outcome"];
  internalMessage?: string;
  authority?: string;
  rule?: string;
  decision?: string;
}

export interface QuoteDto {
  id: string;
  submissionId: string;
  submissionNumber: string;
  revision: number;
  status: Quote["status"];
  approved: boolean;
  currency: string;
  term: { start: string; end: string };
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  boundAt: string | null;
  coverages: QuoteCoverageDto[];
  premium: {
    written: MoneyDto;
    taxesFees: { code: string; label: string; rate?: string; basis: string; amount: MoneyDto }[];
    total: MoneyDto;
    adjustment: { percent: string; reason: string; amount: MoneyDto } | null;
  };
  insuredValue: MoneyDto;
  /** The carrier's quote and any carrier-owned bind in flight (PLAN §12). */
  carrier: CarrierQuoteState | null;
  declineReasons: ReasonDto[];
  referral: {
    reasons: ReasonDto[];
    referredAt: string;
    reviewBy: string;
    decision: {
      outcome: "approved" | "declined";
      by: string;
      note?: string;
      conditions: string[];
      modifications: ReferralModifications | null;
      adverseActionNotice?: string;
      decidedAt: string;
    } | null;
  } | null;
  requirements: BindRequirement[];
  details: BindDetails;
  detailsSaved: boolean;
  signature: { signerName: string; signedAt: string; provider: string } | null;
  signatureConsent: string;
  payment: { brand: string; last4: string; amount: MoneyDto; capturedAt: string } | null;
  policy: { id: string; number: string } | null;
  payPlans: PayPlanOffer[];
  payPlan: string | null;
  autopayConsent: string;
  evaluatedInMs: number;
}

export interface StaffQuoteDto extends QuoteDto {
  evaluation: {
    reasons: ReasonDto[];
    decisions: DecisionRecord[];
    rating: RatingRecord | null;
    evaluatedAt: string;
  };
}

export type QuoteView = "producer" | "staff";

function reasonDto(reason: UnderwritingReason, view: QuoteView): ReasonDto {
  const base = { reasonCode: reason.reasonCode, message: reason.message, outcome: reason.outcome };

  if (view === "producer") return base;

  return {
    ...base,
    ...(reason.internalMessage && { internalMessage: reason.internalMessage }),
    ...(reason.authority && { authority: reason.authority }),
    rule: reason.rule,
    decision: reason.decision,
  };
}

function coverageDtos(quote: Quote): QuoteCoverageDto[] {
  const q = quote.toSnapshot();
  const { offers, premium } = q.evaluation;

  return offers.map((offer) => {
    const exposures = exposuresOf(offer, q.riskData);
    const slots = exposures.length === 0 ? [undefined] : exposures;

    return {
      code: offer.code,
      name: offer.name,
      ...(offer.description && { description: offer.description }),
      required: offer.required,
      dependsOn: offer.dependsOn,
      level: offer.attachesTo.level,
      limits: offer.limits,
      deductibles: offer.deductibles,
      defaultLimit: offer.limits[offer.defaultLimit] ?? null,
      defaultDeductible: offer.deductibles[offer.defaultDeductible] ?? null,
      exposures: slots.map((exposure) => {
        const choice = q.selection.find(
          (c) => c.coverage === offer.code && c.exposure === exposure,
        );

        const line = premium.find((p) => p.coverage === offer.code && p.exposure === exposure);

        return {
          exposure: exposure ?? null,
          label: exposure ? exposureLabel(q.riskData, exposure) : null,
          selected: choice !== undefined,
          limit: choice?.limit ?? null,
          deductible: choice?.deductible ?? null,
          premium: line ? money(line.premium) : null,
        };
      }),
    };
  });
}

function draftDetails(quote: Quote, submission: Submission): BindDetails {
  const q = quote.toSnapshot();

  if (q.details) return q.details;

  const s = submission.toSnapshot();
  const insured = insuredNameOf(q.riskData);

  return {
    namedInsureds: insured ? [insured] : [""],
    mailingAddress: mailingAddressOf(q.riskData),
    additionalInterests: [],
    producer: { name: s.producer.name },
    declinations: [],
    acknowledgements: [],
  };
}

export function toQuoteDto(quote: Quote, submission: Submission, view: "producer"): QuoteDto;
export function toQuoteDto(quote: Quote, submission: Submission, view: "staff"): StaffQuoteDto;

export function toQuoteDto(
  quote: Quote,
  submission: Submission,
  view: QuoteView,
): QuoteDto | StaffQuoteDto {
  const q = quote.toSnapshot();
  const e = q.evaluation;
  const signature = q.signature?.revision === q.revision ? q.signature : null;

  const dto: QuoteDto = {
    id: q.id,
    submissionId: q.submissionId,
    submissionNumber: q.submissionNumber,
    revision: q.revision,
    status: q.status,
    approved: q.referral?.decision?.outcome === "approved" && q.status !== "referred",
    currency: e.total.currency,
    term: { start: q.termStart.toString(), end: q.termEnd.toString() },
    expiresAt: q.expiresAt.toString(),
    createdAt: q.createdAt.toString(),
    updatedAt: q.updatedAt.toString(),
    boundAt: q.boundAt?.toString() ?? null,
    coverages: coverageDtos(quote),
    premium: {
      written: money(e.writtenPremium),
      taxesFees: e.taxesFees.map((line) => ({
        code: line.code,
        label: line.label,
        ...(line.rate !== undefined && { rate: line.rate }),
        basis: line.basis,
        amount: money(line.amount),
      })),
      total: money(e.total),
      adjustment: e.adjustment
        ? {
            percent: e.adjustment.percent,
            reason: e.adjustment.reason,
            amount: money(e.adjustment.amount),
          }
        : null,
    },
    insuredValue: money(insuredValueOf(e.offers, q.selection, e.total.currency)),
    carrier: e.carrier ?? null,
    declineReasons:
      q.status === "declined"
        ? q.referral?.decision?.declineReasons?.length
          ? q.referral.decision.declineReasons.map((r) => ({
              reasonCode: r.code,
              message: r.message,
              outcome: "decline" as const,
            }))
          : (q.referral?.decision?.outcome === "declined"
              ? q.referral.reasons
              : e.reasons.filter((r) => r.outcome === "decline")
            ).map((r) => reasonDto(r, view))
        : [],
    referral: q.referral && {
      reasons: q.referral.reasons.map((r) => reasonDto(r, view)),
      referredAt: q.referral.referredAt.toString(),
      reviewBy: q.referral.reviewBy.toString(),
      decision: q.referral.decision && {
        outcome: q.referral.decision.outcome,
        by: q.referral.decision.by.name,
        ...(q.referral.decision.note && { note: q.referral.decision.note }),
        conditions: q.referral.decision.conditions,
        modifications: q.referral.decision.modifications ?? null,
        ...(q.referral.decision.adverseActionNotice && {
          adverseActionNotice: q.referral.decision.adverseActionNotice,
        }),
        decidedAt: q.referral.decision.decidedAt.toString(),
      },
    },
    requirements: quote.requirements(),
    details: draftDetails(quote, submission),
    detailsSaved: q.details !== null,
    signature: signature && {
      signerName: signature.signerName,
      signedAt: signature.signedAt.toString(),
      provider: signature.provider,
    },
    signatureConsent: ESIGN_CONSENT,
    payment: q.payment && {
      brand: q.payment.brand,
      last4: q.payment.last4,
      amount: money(q.payment.amount),
      capturedAt: q.payment.capturedAt.toString(),
    },
    policy: q.policy,
    payPlans: e.payPlans,
    payPlan: quote.selectedPayPlan()?.key ?? null,
    autopayConsent: AUTOPAY_CONSENT,
    evaluatedInMs: Math.round(e.durationMs),
  };

  if (view === "producer") return dto;

  return {
    ...dto,
    evaluation: {
      reasons: e.reasons.map((r) => reasonDto(r, "staff")),
      decisions: e.decisions,
      rating: e.rating,
      evaluatedAt: e.evaluatedAt.toString(),
    },
  };
}

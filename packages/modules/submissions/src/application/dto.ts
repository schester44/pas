import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction } from "@pas/kernel";
import type { Quote } from "../domain/quote";
import type { RiskData, Submission } from "../domain/submission";

export interface SubmissionSummaryDto {
  id: string;
  number: string;
  status: string;
  productId: string;
  productName: string;
  productReleaseId: string;
  productVersionId: string;
  productVersion: string;
  jurisdiction: Jurisdiction;
  effectiveDate: string;
  channel: string;
  stage: string;
  producer: { id: string; name: string; agencyId: string | null };
  insuredName: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  quote: {
    status: string;
    approved: boolean;
    total: { amount: string; currency: string };
    expiresAt: string;
    policyNumber: string | null;
  } | null;
}

export interface SubmissionDto extends SubmissionSummaryDto {
  formKey: string;
  riskData: RiskData;
  riskSchema: RiskSchema;
  form: FormDefinition;
}

export function toSummaryDto(
  submission: Submission,
  productName: string,
  quote: Quote | null = null,
): SubmissionSummaryDto {
  const s = submission.toSnapshot();
  const q = quote?.toSnapshot();

  return {
    id: s.id,
    number: s.number,
    status: s.status,
    productId: s.productId,
    productName,
    productReleaseId: s.productReleaseId,
    productVersionId: s.productVersionId,
    productVersion: s.productVersion,
    jurisdiction: s.jurisdiction,
    effectiveDate: s.effectiveDate.toString(),
    channel: s.channel,
    stage: s.stage,
    producer: {
      id: s.producer.userId,
      name: s.producer.name,
      agencyId: s.producer.agencyId ?? null,
    },
    insuredName: s.insuredName,
    createdAt: s.createdAt.toString(),
    updatedAt: s.updatedAt.toString(),
    submittedAt: s.submittedAt?.toString() ?? null,
    quote: q
      ? {
          status: q.status,
          approved: q.referral?.decision?.outcome === "approved" && q.status !== "referred",
          total: q.evaluation.total.toJSON(),
          expiresAt: q.expiresAt.toString(),
          policyNumber: q.policy?.number ?? null,
        }
      : null,
  };
}

export function toSubmissionDto(
  submission: Submission,
  productName: string,
  intake: { riskSchema: RiskSchema; form: FormDefinition },
  quote: Quote | null = null,
): SubmissionDto {
  const s = submission.toSnapshot();

  return {
    ...toSummaryDto(submission, productName, quote),
    formKey: s.formKey,
    riskData: s.riskData,
    riskSchema: intake.riskSchema,
    form: intake.form,
  };
}

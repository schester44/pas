import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction } from "@pas/kernel";
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
  producer: { id: string; name: string };
  insuredName: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

export interface SubmissionDto extends SubmissionSummaryDto {
  formKey: string;
  riskData: RiskData;
  riskSchema: RiskSchema;
  form: FormDefinition;
}

export function toSummaryDto(submission: Submission, productName: string): SubmissionSummaryDto {
  const s = submission.toSnapshot();

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
    producer: { id: s.producer.userId, name: s.producer.name },
    insuredName: s.insuredName,
    createdAt: s.createdAt.toString(),
    updatedAt: s.updatedAt.toString(),
    submittedAt: s.submittedAt?.toString() ?? null,
  };
}

export function toSubmissionDto(
  submission: Submission,
  productName: string,
  intake: { riskSchema: RiskSchema; form: FormDefinition },
): SubmissionDto {
  const s = submission.toSnapshot();

  return {
    ...toSummaryDto(submission, productName),
    formKey: s.formKey,
    riskData: s.riskData,
    riskSchema: intake.riskSchema,
    form: intake.form,
  };
}

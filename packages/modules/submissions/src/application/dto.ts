import type { ExtensionFields, ExtensionSurface } from "@pas/extension-points";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction, TenantContext } from "@pas/kernel";
import type { Quote } from "../domain/quote";
import type { RiskData, Submission } from "../domain/submission";
import type { ProductCatalog } from "../ports/product-catalog";

export interface SubmissionNames {
  product: string;
  offering: string | null;
}

export interface QuoteOptionDto {
  productId: string;
  productName: string;
  productReleaseId: string;
  outcome: "quoted" | "referred" | "declined";
  total: { amount: string; currency: string };
  reasons: { code: string; message: string }[];
  chosen: boolean;
}

export interface SubmissionSummaryDto {
  id: string;
  number: string;
  status: string;
  offeringId: string | null;
  offeringName: string | null;
  /** Submitted with options to compare and none chosen yet (PLAN §6.0). */
  awaitingChoice: boolean;
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
  options: QuoteOptionDto[];
  riskData: RiskData;
  riskSchema: RiskSchema;
  form: FormDefinition;
  extensionFields: ExtensionFields;
  surfaces: ExtensionSurface[];
}

export function toSummaryDto(
  submission: Submission,
  names: SubmissionNames,
  quote: Quote | null = null,
): SubmissionSummaryDto {
  const s = submission.toSnapshot();
  const q = quote?.toSnapshot();

  return {
    id: s.id,
    number: s.number,
    status: s.status,
    offeringId: s.offeringId,
    offeringName: names.offering,
    awaitingChoice: s.status === "submitted" && !quote && s.options.length > 0,
    productId: s.productId,
    productName: names.product,
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
  names: SubmissionNames,
  intake: {
    riskSchema: RiskSchema;
    form: FormDefinition;
    extensionFields?: ExtensionFields;
    surfaces?: ExtensionSurface[];
  },
  quote: Quote | null = null,
  productNames: ReadonlyMap<string, string> = new Map(),
): SubmissionDto {
  const s = submission.toSnapshot();

  return {
    ...toSummaryDto(submission, names, quote),
    formKey: s.formKey,
    options: s.options.map((o) => ({
      productId: o.productId,
      productName: productNames.get(o.productId) ?? "Product",
      productReleaseId: o.productReleaseId,
      outcome: o.outcome,
      total: o.total.toJSON(),
      reasons: o.reasons,
      chosen: o.chosen,
    })),
    riskData: s.riskData,
    riskSchema: intake.riskSchema,
    form: intake.form,
    extensionFields: intake.extensionFields ?? { options: [], prefill: [] },
    surfaces: intake.surfaces ?? [],
  };
}

/** Display names for a submission: the pinned product and the offering it was started for. */
export async function submissionNames(
  catalog: ProductCatalog,
  ctx: TenantContext,
  submission: Submission,
): Promise<SubmissionNames> {
  const s = submission.toSnapshot();

  const [product, offerings] = await Promise.all([
    catalog.productName(ctx, s.productId),
    s.offeringId ? catalog.offeringNames(ctx) : null,
  ]);

  return { product, offering: (s.offeringId && offerings?.get(s.offeringId)) ?? null };
}

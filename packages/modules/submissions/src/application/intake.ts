import { asId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import type { Submission } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";

export async function loadSubmission(
  submissions: SubmissionRepository,
  tx: Transaction,
  ctx: TenantContext,
  scope: SubmissionScope,
  id: string,
): Promise<Submission> {
  const submission = await submissions.findById(tx, ctx, scope, asId(id));

  if (!submission) throw notFound("Submission", id);

  return submission;
}

export function intakeForm(release: CatalogRelease, channel: string, stage: string) {
  return release.forms.find((entry) => entry.channel === channel && entry.stage === stage)?.form;
}

/** The exact schema and form a submission was started with, from its pinned release. */
export async function pinnedIntake(
  catalog: ProductCatalog,
  ctx: TenantContext,
  submission: Submission,
) {
  const s = submission.toSnapshot();
  const release = await catalog.getRelease(ctx, s.productReleaseId);
  const form = release.forms.find((entry) => entry.form.key === s.formKey)?.form;

  if (!form) throw new Error(`Release ${release.id} lost form ${s.formKey}`);

  return { riskSchema: release.riskSchema, form };
}

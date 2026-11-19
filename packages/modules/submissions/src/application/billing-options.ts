import type { TenantContext, UnitOfWork } from "@pas/kernel";
import { billingMethodOptions, type BillingMethodOption } from "../domain/billing-methods";
import type { Quote } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import type { Submission } from "../domain/submission";
import type { AgencyBilling } from "../ports/agency-bill-check";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadQuote } from "./quoting";

export async function billingOptionsFor(
  deps: { agencyBilling: AgencyBilling },
  ctx: TenantContext,
  input: { quote: Quote; submission: Submission; release: CatalogRelease },
): Promise<BillingMethodOption[]> {
  const q = input.quote.toSnapshot();
  const s = input.submission.toSnapshot();

  const agency = input.release.billing.methods.includes("agency")
    ? await deps.agencyBilling.check(ctx, {
        producerId: s.producer.userId,
        agencyId: s.producer.agencyId,
        amount: q.evaluation.total,
      })
    : null;

  return billingMethodOptions({
    billing: input.release.billing,
    offers: q.evaluation.payPlans,
    selectedPlan: input.quote.selectedPayPlan()?.key ?? null,
    details: q.details,
    agency,
  });
}

/** How the quote can be billed at bind: direct, through the agency, or to the mortgagee (PLAN §13). */
export function makeBillingOptions(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  agencyBilling: AgencyBilling;
}) {
  return async function billingOptions(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string },
  ): Promise<BillingMethodOption[]> {
    const { submission, quote } = await deps.uow.run(ctx, (tx) =>
      loadQuote(deps, tx, ctx, scope, input.submissionId),
    );

    const release = await deps.catalog.getRelease(ctx, quote.toSnapshot().productReleaseId);

    return billingOptionsFor(deps, ctx, { quote, submission, release });
  };
}

export type BillingOptions = ReturnType<typeof makeBillingOptions>;

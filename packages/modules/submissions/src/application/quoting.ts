import { conflict, type PlainDate, type TenantContext, type Transaction } from "@pas/kernel";
import type { Quote } from "../domain/quote";
import { quoteTermsFrom } from "../domain/quote-terms";
import type { SubmissionScope } from "../domain/scope";
import type { Submission } from "../domain/submission";
import type { CatalogRelease } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadSubmission } from "./intake";

export async function loadQuote(
  repos: { submissions: SubmissionRepository; quotes: QuoteRepository },
  tx: Transaction,
  ctx: TenantContext,
  scope: SubmissionScope,
  submissionId: string,
): Promise<{ submission: Submission; quote: Quote }> {
  const submission = await loadSubmission(repos.submissions, tx, ctx, scope, submissionId);
  const quote = await repos.quotes.findBySubmission(tx, ctx, submission.id);

  if (!quote) {
    throw conflict(`${submission.toSnapshot().number} hasn't been quoted yet`, {
      reason: "not_quoted",
    });
  }

  return { submission, quote };
}

export function termOf(release: CatalogRelease, effectiveDate: PlainDate) {
  const terms = quoteTermsFrom(release.lifecycle);

  return {
    terms,
    termStart: effectiveDate,
    termEnd: effectiveDate.add({ months: terms.termMonths }),
    reviewWithin: Temporal.Duration.from({ hours: terms.referralReviewHours }),
  };
}

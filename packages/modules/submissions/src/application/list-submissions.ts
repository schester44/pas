import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionSummaryDto, toSummaryDto } from "./dto";

export function makeListSubmissions(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
}) {
  return async function listSubmissions(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { limit?: number } = {},
  ): Promise<SubmissionSummaryDto[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

    const [{ submissions, quotes }, names, offerings] = await Promise.all([
      deps.uow.run(ctx, async (tx) => {
        const found = await deps.submissions.list(tx, ctx, scope, { limit });
        const ids = found.map((submission) => submission.id);

        return { submissions: found, quotes: await deps.quotes.listBySubmissions(tx, ctx, ids) };
      }),
      deps.catalog.productNames(ctx),
      deps.catalog.offeringNames(ctx),
    ]);

    const bySubmission = new Map(quotes.map((q) => [q.toSnapshot().submissionId, q]));

    return submissions.map((submission) => {
      const s = submission.toSnapshot();

      return toSummaryDto(
        submission,
        {
          product: names.get(s.productId) ?? "Product",
          offering: (s.offeringId && offerings.get(s.offeringId)) ?? null,
        },
        bySubmission.get(submission.id) ?? null,
      );
    });
  };
}

export type ListSubmissions = ReturnType<typeof makeListSubmissions>;

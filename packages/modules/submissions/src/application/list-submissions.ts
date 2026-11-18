import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionSummaryDto, toSummaryDto } from "./dto";

export function makeListSubmissions(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
}) {
  return async function listSubmissions(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { limit?: number } = {},
  ): Promise<SubmissionSummaryDto[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);

    const [submissions, names] = await Promise.all([
      deps.uow.run(ctx, (tx) => deps.submissions.list(tx, ctx, scope, { limit })),
      deps.catalog.productNames(ctx),
    ]);

    return submissions.map((submission) =>
      toSummaryDto(submission, names.get(submission.toSnapshot().productId) ?? "Product"),
    );
  };
}

export type ListSubmissions = ReturnType<typeof makeListSubmissions>;

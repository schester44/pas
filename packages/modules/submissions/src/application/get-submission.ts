import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionDto, toSubmissionDto } from "./dto";
import { loadSubmission, pinnedIntake } from "./intake";

export function makeGetSubmission(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
}) {
  return async function getSubmission(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { id: string },
  ): Promise<SubmissionDto> {
    const { submission, quote } = await deps.uow.run(ctx, async (tx) => {
      const found = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);

      return { submission: found, quote: await deps.quotes.findBySubmission(tx, ctx, found.id) };
    });

    const [productName, intake] = await Promise.all([
      deps.catalog.productName(ctx, submission.toSnapshot().productId),
      pinnedIntake(deps.catalog, ctx, submission),
    ]);

    return toSubmissionDto(submission, productName, intake, quote);
  };
}

export type GetSubmission = ReturnType<typeof makeGetSubmission>;

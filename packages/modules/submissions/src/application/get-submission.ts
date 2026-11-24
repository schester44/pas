import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionDto, submissionNames, toSubmissionDto } from "./dto";
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

    const [names, intake, productNames] = await Promise.all([
      submissionNames(deps.catalog, ctx, submission),
      pinnedIntake(deps.catalog, ctx, submission),
      deps.catalog.productNames(ctx),
    ]);

    return toSubmissionDto(submission, names, intake, quote, productNames);
  };
}

export type GetSubmission = ReturnType<typeof makeGetSubmission>;

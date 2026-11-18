import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadSubmission } from "./intake";
import { type QuoteDto, type StaffQuoteDto, toQuoteDto } from "./quote-dto";

export function makeGetQuote(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
}) {
  async function load(ctx: TenantContext, scope: SubmissionScope, submissionId: string) {
    return deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, submissionId);
      const quote = await deps.quotes.findBySubmission(tx, ctx, submission.id);

      return quote ? { submission, quote } : null;
    });
  }

  return {
    async forProducer(
      ctx: TenantContext,
      scope: SubmissionScope,
      input: { submissionId: string },
    ): Promise<QuoteDto | null> {
      const found = await load(ctx, scope, input.submissionId);

      return found && toQuoteDto(found.quote, found.submission, "producer");
    },
    async forStaff(
      ctx: TenantContext,
      scope: SubmissionScope,
      input: { submissionId: string },
    ): Promise<StaffQuoteDto | null> {
      const found = await load(ctx, scope, input.submissionId);

      return found && toQuoteDto(found.quote, found.submission, "staff");
    },
  };
}

export type GetQuote = ReturnType<typeof makeGetQuote>;

import type { ClockProvider, TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type QuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote } from "./quoting";

/** Picks one of the quote's eligible pay plans (PLAN §7.2.1 step 2). */
export function makeChoosePayPlan(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  clocks: ClockProvider;
}) {
  return async function choosePayPlan(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; payPlan: string },
  ): Promise<QuoteDto> {
    return deps.uow.run(ctx, async (tx) => {
      const { submission, quote } = await loadQuote(deps, tx, ctx, scope, input.submissionId);

      quote.choosePayPlan(input.payPlan, deps.clocks.forTenant(ctx.tenantId));
      await deps.quotes.save(tx, quote);

      return toQuoteDto(quote, submission, "producer");
    });
  };
}

export type ChoosePayPlan = ReturnType<typeof makeChoosePayPlan>;

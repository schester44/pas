import type { ClockProvider, TenantContext, UnitOfWork } from "@pas/kernel";
import type { CompletionRules } from "../domain/completion";
import type { SubmissionScope } from "../domain/scope";
import type { ClientRequestRepository } from "../ports/client-request-repository";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type ClientRequestDto, completionRulesFor, toClientRequestDto } from "./client-requests";
import { loadQuote } from "./quoting";

export interface ClientCompletionDto {
  rules: CompletionRules;
  request: ClientRequestDto | null;
}

/** For the producer: who completes each step, and where the insured's request stands. */
export function makeGetClientCompletion(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  requests: ClientRequestRepository;
  clocks: ClockProvider;
}) {
  return async function getClientCompletion(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string },
  ): Promise<ClientCompletionDto> {
    const rules = await completionRulesFor(deps, ctx, scope, input.submissionId);

    const request = await deps.uow.run(ctx, async (tx) => {
      const { quote } = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const latest = await deps.requests.findLatestByQuote(tx, ctx, quote.id);

      return latest && toClientRequestDto(latest, deps.clocks.forTenant(ctx.tenantId).now(), quote);
    });

    return { rules, request };
  };
}

export type GetClientCompletion = ReturnType<typeof makeGetClientCompletion>;

import type { TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import type { BindDetails } from "../domain/bind-details";
import type { SubmissionScope } from "../domain/scope";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type QuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote } from "./quoting";

export type BindDetailsInput = Omit<BindDetails, "acknowledgements"> & {
  acknowledgements: string[];
};

/** Saves the legal and compliance details; accepting an attestation is timestamped here. */
export function makeSaveBindDetails(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  clocks: ClockProvider;
}) {
  return async function saveBindDetails(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; details: BindDetailsInput },
  ): Promise<QuoteDto> {
    return deps.uow.run(ctx, async (tx) => {
      const { submission, quote } = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const previous = quote.toSnapshot().details?.acknowledgements ?? [];
      const now = deps.clocks.forTenant(ctx.tenantId).now().toString();
      const offered = new Set(quote.toSnapshot().evaluation.attestations.map((a) => a.code));

      const details: BindDetails = {
        ...input.details,
        namedInsureds: input.details.namedInsureds.map((name) => name.trim()).filter(Boolean),
        acknowledgements: [...new Set(input.details.acknowledgements)]
          .filter((code) => offered.has(code))
          .map((code) => previous.find((ack) => ack.code === code) ?? { code, acceptedAt: now }),
      };

      quote.saveDetails(details, deps.clocks.forTenant(ctx.tenantId));
      await deps.quotes.save(tx, quote);

      return toQuoteDto(quote, submission, "producer");
    });
  };
}

export type SaveBindDetails = ReturnType<typeof makeSaveBindDetails>;

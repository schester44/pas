import {
  asId,
  type ClockProvider,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import type { ActivityActor, QuoteActivityType } from "../domain/quote-activity";
import type { QuoteRepository } from "../ports/quote-repository";

/** Adds another context's pre-bind step to the quote's history, inside the caller's transaction. */
export function makeRecordQuoteActivity(deps: { quotes: QuoteRepository; clocks: ClockProvider }) {
  return async function recordQuoteActivity(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      quoteId: string;
      type: QuoteActivityType;
      actor: ActivityActor;
      summary: string;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    const quote = await deps.quotes.findById(tx, ctx, asId(input.quoteId));

    if (!quote) throw notFound("Quote", input.quoteId);

    quote.note(
      input.type,
      input.actor,
      input.summary,
      input.data,
      deps.clocks.forTenant(ctx.tenantId),
    );

    await deps.quotes.save(tx, quote);
  };
}

export type RecordQuoteActivity = ReturnType<typeof makeRecordQuoteActivity>;

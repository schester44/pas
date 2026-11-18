import { asId, type Clock, type Outbox, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { QuoteStatus } from "../domain/quote";
import type { QuoteRepository } from "../ports/quote-repository";

export interface JourneyState {
  status: QuoteStatus;
  msUntilExpiry: number;
}

/** What the journey workflow reads and does on its timers; aggregates stay the source of truth. */
export function makeQuoteTimers(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  quotes: QuoteRepository;
  clock: Clock;
}) {
  return {
    async state(ctx: TenantContext, input: { quoteId: string }): Promise<JourneyState> {
      const quote = await deps.uow.run(ctx, (tx) =>
        deps.quotes.findById(tx, ctx, asId(input.quoteId)),
      );

      if (!quote) throw new Error(`Quote ${input.quoteId} is gone`);

      const expiresAt = quote.toSnapshot().expiresAt;

      return {
        status: quote.status,
        msUntilExpiry: Math.max(0, deps.clock.now().until(expiresAt).total("milliseconds")),
      };
    },
    async expire(ctx: TenantContext, input: { quoteId: string }): Promise<QuoteStatus> {
      return deps.uow.run(ctx, async (tx) => {
        const quote = await deps.quotes.findById(tx, ctx, asId(input.quoteId));

        if (!quote) throw new Error(`Quote ${input.quoteId} is gone`);

        if (quote.expire(deps.clock)) {
          await deps.quotes.save(tx, quote);
          await deps.outbox.add(tx, quote.pullEvents());
        }

        return quote.status;
      });
    },
  };
}

export type QuoteTimers = ReturnType<typeof makeQuoteTimers>;

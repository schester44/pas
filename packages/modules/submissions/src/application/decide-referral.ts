import type { Outbox, TenantContext, UnitOfWork, ClockProvider } from "@pas/kernel";
import type { Underwriter } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { JOURNEY_EVENTS, type QuoteJourney } from "./quote-journey";
import { type StaffQuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote } from "./quoting";

export interface ReferralDecisionInput {
  submissionId: string;
  outcome: "approve" | "decline";
  note?: string;
  conditions?: string[];
  underwriterName: string;
}

/** An underwriter's call on a referred quote; resumes the paused journey (PLAN §11). */
export function makeDecideReferral(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  journey: QuoteJourney;
  clocks: ClockProvider;
}) {
  return async function decideReferral(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: ReferralDecisionInput,
  ): Promise<StaffQuoteDto> {
    const by: Underwriter = {
      userId: ctx.actor.type === "user" ? ctx.actor.userId : null,
      name: input.underwriterName,
    };

    const note = input.note?.trim() || undefined;

    const { submission, quote } = await deps.uow.run(ctx, async (tx) => {
      const loaded = await loadQuote(deps, tx, ctx, scope, input.submissionId);

      if (input.outcome === "approve") {
        const conditions = (input.conditions ?? []).map((c) => c.trim()).filter(Boolean);

        loaded.quote.approve(
          { by, ...(note && { note }), conditions },
          deps.clocks.forTenant(ctx.tenantId),
        );
      } else {
        loaded.quote.decline({ by, ...(note && { note }) }, deps.clocks.forTenant(ctx.tenantId));
      }

      await deps.quotes.save(tx, loaded.quote);
      await deps.outbox.add(tx, loaded.quote.pullEvents());

      return loaded;
    });

    await deps.journey.signal(ctx, quote, JOURNEY_EVENTS.underwriting, {
      outcome: input.outcome === "approve" ? "approved" : "declined",
    });

    return toQuoteDto(quote, submission, "staff");
  };
}

export type DecideReferral = ReturnType<typeof makeDecideReferral>;

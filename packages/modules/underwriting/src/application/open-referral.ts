import type { TenantContext } from "@pas/kernel";
import { requiredLevel } from "../domain/authority";
import { Referral, type ReferralQuote } from "../domain/referral";
import type { QuoteFacts } from "../ports/quote-desk";
import { clockOf, persist, type UnderwritingDeps } from "./deps";

const referralQuote = (facts: QuoteFacts, fallbackDue: Temporal.Instant): ReferralQuote => ({
  revision: facts.revision,
  reasons: facts.reasons,
  writtenPremium: facts.writtenPremium,
  total: facts.total,
  insuredValue: facts.insuredValue,
  dueAt: facts.reviewBy ?? fallbackDue,
});

/**
 * A referred quote joins the underwriter queue (PLAN §11). Its SLA is the quote's review-by time
 * from the product's lifecycle config; a quote referred again while open refreshes its referral.
 */
export function makeOpenReferral(deps: UnderwritingDeps) {
  return async function openReferral(ctx: TenantContext, input: { submissionId: string }) {
    const facts = await deps.quotes.facts(ctx, input);

    if (facts.status !== "referred") return { status: "skipped" as const };

    const clock = clockOf(deps, ctx);

    return deps.uow.run(ctx, async (tx) => {
      const settings = await deps.settings.get(tx, ctx);

      const level = requiredLevel(
        settings.authorityProfiles,
        facts.reasons.flatMap((r) => (r.authority ? [r.authority] : [])),
      );

      const quote = referralQuote(facts, clock.now().add({ hours: 24 }));
      const existing = await deps.referrals.findOpenByQuote(tx, ctx, facts.quoteId);

      if (existing) {
        if (existing.toSnapshot().quote.revision === facts.revision) {
          return { status: "exists" as const, referralId: existing.id };
        }

        existing.refresh(quote, level, clock);
        await persist(deps, tx, existing);

        return { status: "refreshed" as const, referralId: existing.id };
      }

      const referral = Referral.open(
        {
          tenantId: ctx.tenantId,
          quoteId: facts.quoteId,
          submissionId: facts.submissionId,
          submissionNumber: facts.submissionNumber,
          productId: facts.productId,
          productName: facts.productName,
          jurisdiction: facts.jurisdiction,
          insuredName: facts.insuredName,
          producer: facts.producer,
          quote,
          requiredLevel: level,
        },
        clock,
      );

      await persist(deps, tx, referral);

      return { status: "opened" as const, referralId: referral.id };
    });
  };
}

/** The quote left review without an underwriter (expired, declined by the rules, withdrawn). */
export function makeCloseReferrals(deps: UnderwritingDeps) {
  return async function closeReferrals(
    ctx: TenantContext,
    input: { quoteId: string; reason: string },
  ) {
    await deps.uow.run(ctx, async (tx) => {
      const referral = await deps.referrals.findOpenByQuote(tx, ctx, input.quoteId);

      if (!referral) return;

      referral.close(input.reason, clockOf(deps, ctx));
      await persist(deps, tx, referral);
    });
  };
}

import { defineWorkflow, type TenantContext } from "@pas/kernel";
import type { Logger } from "@pas/observability";
import {
  JOURNEY_EVENTS,
  type QuoteStatus,
  type QuoteTimers,
  quoteJourneyWorkflow,
} from "@pas/submissions";

const TERMINAL: ReadonlySet<QuoteStatus> = new Set(["bound", "declined", "expired"]);
const MAX_ROUNDS = 200;

const untilExpiry = (ms: number) => ({ seconds: Math.max(1, Math.ceil(ms / 1000)) });

/**
 * Coordinates one quote from quoted to bound (PLAN §7.2.1): pauses on referral until an
 * underwriter decides, and expires the quote when its validity runs out. The quote aggregate
 * owns every state change; this only waits and nudges.
 */
export function makeQuoteJourneyWorkflow(deps: { timers: QuoteTimers; logger: Logger }) {
  return defineWorkflow(quoteJourneyWorkflow, async ({ input, tenantId, runId, step }) => {
    const ctx: TenantContext = { tenantId, actor: { type: "system", process: "quote.journey" } };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const state = await step.run(`state-${round}`, () => deps.timers.state(ctx, input));

      if (TERMINAL.has(state.status)) return { status: state.status, rounds: round };

      const timeout = untilExpiry(state.msUntilExpiry);

      if (state.status === "referred") {
        await step.run(`referral-opened-${round}`, async () => {
          deps.logger.info({ runId, quoteId: input.quoteId }, "quote referred to underwriting");

          return true;
        });

        const decision = await step.waitFor(JOURNEY_EVENTS.underwriting, {
          stepId: `underwriting-${round}`,
          timeout,
        });

        if (!decision) {
          await step.run(`expire-${round}`, () => deps.timers.expire(ctx, input));
          continue;
        }

        await step.run(`resume-${round}`, async () => {
          deps.logger.info(
            { runId, quoteId: input.quoteId, decision },
            "underwriting decided; the journey resumes",
          );

          return decision;
        });

        continue;
      }

      const change = await step.waitFor(JOURNEY_EVENTS.changed, {
        stepId: `changed-${round}`,
        timeout,
      });

      if (!change) await step.run(`expire-${round}`, () => deps.timers.expire(ctx, input));
    }

    throw new Error(`Quote ${input.quoteId} changed more than ${MAX_ROUNDS} times`);
  });
}

import {
  invalid,
  type TenantContext,
  workflowRef,
  workflowSubject,
  type Workflows,
} from "@pas/kernel";
import type { Quote } from "../domain/quote";

export interface QuoteJourneyInput {
  quoteId: string;
  submissionId: string;
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

/** The durable quote-to-bind journey (PLAN §7.2.1). Its handler runs in the worker. */
export const quoteJourneyWorkflow = workflowRef<QuoteJourneyInput>("quote.journey", {
  parse(value) {
    const input = value as Partial<QuoteJourneyInput> | null;

    if (!isUuid(input?.quoteId) || !isUuid(input?.submissionId)) {
      throw invalid("quote.journey needs a quoteId and submissionId");
    }

    return { quoteId: input.quoteId, submissionId: input.submissionId };
  },
});

export const JOURNEY_EVENTS = {
  changed: "quote.changed",
  underwriting: "underwriting.decision",
} as const;

export type JourneyEvent = (typeof JOURNEY_EVENTS)[keyof typeof JOURNEY_EVENTS];

/** Starts are idempotent per quote, so signalling never needs a stored run id. */
export class QuoteJourney {
  /** `onPriced` follows every start and signal, e.g. to ask the carrier for its quote. */
  constructor(
    private readonly workflows: Workflows,
    private readonly onPriced?: (ctx: TenantContext, quote: Quote) => Promise<void>,
  ) {}

  async start(ctx: TenantContext, quote: Quote) {
    const q = quote.toSnapshot();

    const run = await this.workflows.start(
      ctx,
      quoteJourneyWorkflow,
      { quoteId: q.id, submissionId: q.submissionId },
      {
        idempotencyKey: `quote.journey:${q.id}`,
        subjects: [workflowSubject("quote", q.id), workflowSubject("submission", q.submissionId)],
      },
    );

    await this.onPriced?.(ctx, quote);

    return run;
  }

  async signal(
    ctx: TenantContext,
    quote: Quote,
    event: JourneyEvent,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const { runId } = await this.start(ctx, quote);
    await this.workflows.signal(ctx, runId, event, { status: quote.status, ...data });
  }
}

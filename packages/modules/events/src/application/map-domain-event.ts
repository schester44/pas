import type { TenantContext } from "@pas/kernel";
import type { PublicEventType } from "../domain/event-types";
import type { EventSubjects } from "../ports/subjects";
import type { EventData, MoneyValue, TransactionSnapshot } from "./payloads";

/** A domain event as it arrives from the outbox. */
export interface InternalEvent {
  id: string;
  type: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: unknown;
}

export type PublicEventDraft = {
  [T in PublicEventType]: { type: T; data: EventData<T> };
}[PublicEventType];

type Mapper = (
  event: InternalEvent,
  payload: Record<string, unknown>,
  subjects: EventSubjects,
  ctx: TenantContext,
) => Promise<PublicEventDraft[]>;

const text = (value: unknown) => (typeof value === "string" ? value : null);

const texts = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const money = (value: unknown): MoneyValue | null => {
  const v = value as Partial<MoneyValue> | null;

  return v && typeof v.amount === "string" && typeof v.currency === "string"
    ? { amount: v.amount, currency: v.currency }
    : null;
};

async function quoted(subjects: EventSubjects, ctx: TenantContext, submissionId: string | null) {
  const found = submissionId ? await subjects.submission(ctx, submissionId) : null;

  return found?.quote ? { submission: found.submission, quote: found.quote } : null;
}

const TRANSACTION_EVENTS: Record<TransactionSnapshot["type"], PublicEventType> = {
  NEW_BUSINESS: "policy.issued",
  ENDORSEMENT: "policy.endorsed",
  CANCELLATION: "policy.cancelled",
  CANCELLATION_RESCISSION: "policy.cancellation_rescinded",
  REINSTATEMENT: "policy.reinstated",
};

const isTransactionType = (value: unknown): value is TransactionSnapshot["type"] =>
  typeof value === "string" && Object.hasOwn(TRANSACTION_EVENTS, value);

async function billed(
  subjects: EventSubjects,
  ctx: TenantContext,
  policyId: string,
  invoiceId: string | null,
) {
  if (!invoiceId) return null;

  const [policy, invoice] = await Promise.all([
    subjects.policy(ctx, policyId),
    subjects.invoice(ctx, invoiceId),
  ]);

  return policy && invoice ? { policy, invoice } : null;
}

/**
 * The explicit map from internal domain events to the public catalog (PLAN §15.8). Internal
 * payloads never leave PAS: each public event is rebuilt from snapshots of the records it's about.
 */
const MAPPERS: Record<string, Mapper> = {
  "submissions.submission_submitted": async (event, _, subjects, ctx) => {
    const found = await subjects.submission(ctx, event.aggregateId);

    return found ? [{ type: "submission.submitted", data: { submission: found.submission } }] : [];
  },
  "submissions.quote_referred": async (_, payload, subjects, ctx) => {
    const data = await quoted(subjects, ctx, text(payload.submissionId));

    return data ? [{ type: "quote.referred", data }] : [];
  },
  "submissions.quote_approved": async (_, payload, subjects, ctx) => {
    const data = await quoted(subjects, ctx, text(payload.submissionId));

    return data
      ? [{ type: "quote.approved", data: { ...data, conditions: texts(payload.conditions) } }]
      : [];
  },
  "submissions.quote_declined": async (_, payload, subjects, ctx) => {
    const data = await quoted(subjects, ctx, text(payload.submissionId));
    const declinedBy = payload.by === "rules" ? "rules" : "underwriter";

    return data ? [{ type: "quote.declined", data: { ...data, declinedBy } }] : [];
  },
  "submissions.quote_bound": async (_, payload, subjects, ctx) => {
    const data = await quoted(subjects, ctx, text(payload.submissionId));
    const policyId = text(payload.policyId);
    const number = text(payload.policyNumber);

    return data && policyId && number
      ? [{ type: "quote.bound", data: { ...data, policy: { id: policyId, number } } }]
      : [];
  },
  "policy.transaction_issued": async (event, payload, subjects, ctx) => {
    const transactionId = text(payload.transactionId);

    if (!isTransactionType(payload.type) || !transactionId) return [];

    const policy = await subjects.policy(ctx, event.aggregateId);

    if (!policy) return [];

    const transaction: TransactionSnapshot = {
      id: transactionId,
      type: payload.type,
      effectiveDate: text(payload.effectiveDate) ?? policy.effectiveDate,
    };

    return [
      { type: TRANSACTION_EVENTS[payload.type], data: { policy, transaction } } as PublicEventDraft,
    ];
  },
  "policy.cancellation_scheduled": async (event, payload, subjects, ctx) => {
    const policy = await subjects.policy(ctx, event.aggregateId);
    const transactionId = text(payload.transactionId);
    const effectiveDate = text(payload.effectiveDate);

    return policy && transactionId && effectiveDate
      ? [
          {
            type: "policy.cancellation_scheduled",
            data: { policy, cancellation: { transactionId, effectiveDate } },
          },
        ]
      : [];
  },
  "policy.timeline_recorded": async (event, payload, subjects, ctx) => {
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const invoiceId = text(payload.invoiceId);

    switch (payload.type) {
      case "invoice_issued": {
        if (data.kind !== "invoice" || data.spread) return [];

        const found = await billed(subjects, ctx, event.aggregateId, invoiceId);

        return found ? [{ type: "invoice.issued", data: found }] : [];
      }
      case "past_due": {
        const found = await billed(subjects, ctx, event.aggregateId, invoiceId);

        return found ? [{ type: "invoice.past_due", data: found }] : [];
      }
      case "payment_received": {
        const found = await billed(subjects, ctx, event.aggregateId, invoiceId);

        return found
          ? [
              {
                type: "payment.received",
                data: { ...found, payment: { amount: money(data.amount) } },
              },
            ]
          : [];
      }
      case "payment_failed": {
        const found = await billed(subjects, ctx, event.aggregateId, invoiceId);
        const payment = { amount: money(data.amount), reason: text(data.reason) };

        return found ? [{ type: "payment.failed", data: { ...found, payment } }] : [];
      }
      default:
        return [];
    }
  },
  "compliance.obligation_overdue": async (event, _, subjects, ctx) => {
    const obligation = await subjects.obligation(ctx, event.aggregateId);

    return obligation ? [{ type: "obligation.overdue", data: { obligation } }] : [];
  },
  "compliance.filing_rejected": async (event, payload, subjects, ctx) => {
    const obligation = await subjects.obligation(ctx, event.aggregateId);
    const filingId = text(payload.filingId);

    return obligation && filingId
      ? [
          {
            type: "filing.rejected",
            data: { obligation, filing: { id: filingId, reasons: texts(payload.reasons) } },
          },
        ]
      : [];
  },
};

export const MAPPED_DOMAIN_EVENTS = Object.keys(MAPPERS);

export async function mapDomainEvent(
  event: InternalEvent,
  subjects: EventSubjects,
  ctx: TenantContext,
): Promise<PublicEventDraft[]> {
  const mapper = MAPPERS[event.type];

  return mapper
    ? mapper(event, (event.payload ?? {}) as Record<string, unknown>, subjects, ctx)
    : [];
}

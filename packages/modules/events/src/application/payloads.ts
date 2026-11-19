import { z } from "zod";

export const moneySchema = z
  .object({
    amount: z.string().describe("Decimal string, never a float"),
    currency: z.string().length(3),
  })
  .meta({ id: "Money" });

const productSchema = z.object({
  id: z.string(),
  key: z.string().describe("The product's stable key"),
  name: z.string(),
});

const partySchema = z.object({ id: z.string(), name: z.string() });

const jurisdictionSchema = z.object({
  country: z.string().describe("ISO 3166-1 alpha-2"),
  subdivision: z.string().nullable().describe("ISO 3166-2 subdivision code, e.g. US-FL"),
});

export const submissionSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  product: productSchema,
  jurisdiction: jurisdictionSchema,
  effectiveDate: z.iso.date(),
  insuredName: z.string().nullable(),
  producer: partySchema,
});

export const quoteSchema = z.object({
  id: z.string(),
  status: z.string(),
  premium: z.object({ written: moneySchema, total: moneySchema }),
  expiresAt: z.iso.datetime({ offset: true }),
  referralReasons: z.array(z.object({ code: z.string(), message: z.string() })),
});

export const policySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  product: productSchema,
  jurisdiction: jurisdictionSchema,
  insuredName: z.string(),
  producer: partySchema,
  agency: partySchema.nullable(),
  effectiveDate: z.iso.date(),
  expirationDate: z.iso.date(),
  writtenPremium: moneySchema,
  total: moneySchema,
});

export const transactionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "NEW_BUSINESS",
    "ENDORSEMENT",
    "CANCELLATION",
    "CANCELLATION_RESCISSION",
    "REINSTATEMENT",
  ]),
  effectiveDate: z.iso.date(),
});

export const invoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  kind: z.enum(["invoice", "credit_note"]),
  status: z.string(),
  issuedOn: z.iso.date(),
  dueOn: z.iso.date(),
  total: moneySchema,
  balance: moneySchema,
  installment: z.object({ number: z.number().int(), of: z.number().int() }).nullable(),
});

export const obligationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  jurisdiction: z.string(),
  dueDate: z.iso.date(),
  policy: z.object({ id: z.string(), number: z.string() }).nullable(),
});

export type MoneyValue = z.infer<typeof moneySchema>;
export type SubmissionSnapshot = z.infer<typeof submissionSchema>;
export type QuoteSnapshot = z.infer<typeof quoteSchema>;
export type PolicySnapshot = z.infer<typeof policySchema>;
export type TransactionSnapshot = z.infer<typeof transactionSchema>;
export type InvoiceSnapshot = z.infer<typeof invoiceSchema>;
export type ObligationSnapshot = z.infer<typeof obligationSchema>;

const quoted = z.object({ submission: submissionSchema, quote: quoteSchema });
const transacted = z.object({ policy: policySchema, transaction: transactionSchema });
const billed = z.object({ policy: policySchema, invoice: invoiceSchema });

export const eventDataSchemas = {
  "submission.submitted": z.object({ submission: submissionSchema }),
  "quote.referred": quoted,
  "quote.approved": quoted.extend({ conditions: z.array(z.string()) }),
  "quote.declined": quoted.extend({ declinedBy: z.enum(["underwriter", "rules"]) }),
  "quote.bound": quoted.extend({ policy: z.object({ id: z.string(), number: z.string() }) }),
  "policy.issued": transacted,
  "policy.endorsed": transacted,
  "policy.cancellation_scheduled": z.object({
    policy: policySchema,
    cancellation: z.object({ transactionId: z.string(), effectiveDate: z.iso.date() }),
  }),
  "policy.cancellation_rescinded": transacted,
  "policy.cancelled": transacted,
  "policy.reinstated": transacted,
  "invoice.issued": billed,
  "invoice.past_due": billed,
  "payment.received": billed.extend({ payment: z.object({ amount: moneySchema.nullable() }) }),
  "payment.failed": billed.extend({
    payment: z.object({ amount: moneySchema.nullable(), reason: z.string().nullable() }),
  }),
  "obligation.overdue": z.object({ obligation: obligationSchema }),
  "filing.rejected": z.object({
    obligation: obligationSchema,
    filing: z.object({ id: z.string(), reasons: z.array(z.string()) }),
  }),
} as const;

export type EventDataSchemas = typeof eventDataSchemas;
export type EventData<T extends keyof EventDataSchemas> = z.infer<EventDataSchemas[T]>;

export const envelopeSchema = z.object({
  id: z.string().describe("evt_…; the idempotency key for this event"),
  object: z.literal("event"),
  type: z.string(),
  apiVersion: z.string(),
  createdAt: z.iso.datetime({ offset: true }).describe("When it happened"),
  environment: z.enum(["production", "sandbox"]),
  test: z.boolean().optional(),
  data: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof envelopeSchema>;

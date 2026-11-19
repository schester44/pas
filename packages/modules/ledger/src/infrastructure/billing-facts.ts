import { Money, parseInstant, parsePlainDate } from "@pas/kernel";
import { z } from "zod";
import type { BillingFact } from "../application/ingest-billing-fact";

const money = z.object({ amount: z.string(), currency: z.string().length(3) });

const charge = z.object({
  kind: z.enum(["written_premium", "tax_fee", "installment_fee"]),
  code: z.string(),
  amount: money,
});

const invoiceIssued = z.object({
  occurredAt: z.string(),
  invoice: z.object({
    id: z.string(),
    number: z.string(),
    kind: z.enum(["invoice", "credit_note"]),
    policyId: z.string(),
    policyNumber: z.string(),
    payer: z.string(),
    payerRef: z.string().nullable(),
    payerName: z.string().nullable(),
    jurisdiction: z.string().nullable().optional(),
    currency: z.string().length(3),
    issuedOn: z.string(),
    dueOn: z.string(),
    status: z.string(),
    lines: z.array(charge),
  }),
});

const invoiceOpened = z.object({
  occurredAt: z.string(),
  invoiceId: z.string(),
  billedOn: z.string(),
  fee: money,
});

const eventApplied = z.object({
  appliedAt: z.string(),
  eventId: z.string(),
  source: z.string(),
  type: z.string(),
  invoiceId: z.string(),
  creditNoteId: z.string().nullable().optional(),
  amount: money.nullable().optional(),
  lines: z.array(charge.extend({ kind: z.string() })).optional(),
  provider: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  method: z
    .object({ brand: z.string().optional(), last4: z.string().optional() })
    .nullable()
    .optional(),
});

const statementIssued = z.object({
  occurredAt: z.string(),
  statementId: z.string(),
  number: z.string(),
  dueOn: z.string(),
  invoiceIds: z.array(z.string()),
});

const commissionsRecorded = z.object({
  occurredAt: z.string(),
  policyId: z.string(),
  agencyId: z.string().nullable(),
  commissionBasis: z.enum(["written", "collected"]).nullable().optional(),
  lines: z.array(z.object({ financialTransactionId: z.string(), amount: money })),
});

const chargeKind = (kind: string) =>
  kind === "tax_fee" || kind === "installment_fee" ? kind : ("written_premium" as const);

/** PAS's outbound billing facts as queue payloads, validated at the edge. Unknown types are ignored. */
export function parseBillingFact(type: string, data: unknown): BillingFact | null {
  switch (type) {
    case "billing.invoice_issued": {
      const f = invoiceIssued.parse(data);
      const i = f.invoice;

      return {
        type,
        occurredAt: parseInstant(f.occurredAt),
        invoice: {
          invoiceId: i.id,
          number: i.number,
          kind: i.kind,
          policyId: i.policyId,
          policyNumber: i.policyNumber,
          payer: i.payer,
          payerRef: i.payerRef,
          payerName: i.payerName,
          jurisdiction: i.jurisdiction ?? null,
          currency: i.currency,
          issuedOn: parsePlainDate(i.issuedOn),
          dueOn: parsePlainDate(i.dueOn),
          status: i.status,
          lines: i.lines.map((l) => ({
            kind: l.kind,
            code: l.code,
            amount: Money.fromJSON(l.amount),
          })),
        },
      };
    }
    case "billing.invoice_opened": {
      const o = invoiceOpened.parse(data);

      return {
        type,
        occurredAt: parseInstant(o.occurredAt),
        opened: {
          invoiceId: o.invoiceId,
          billedOn: parsePlainDate(o.billedOn),
          fee: Money.fromJSON(o.fee),
        },
      };
    }
    case "billing.event_applied": {
      const e = eventApplied.parse(data);

      return {
        type,
        occurredAt: parseInstant(e.appliedAt),
        event: {
          eventId: e.eventId,
          source: e.source,
          type: e.type,
          invoiceId: e.invoiceId,
          creditNoteId: e.creditNoteId ?? null,
          amount: e.amount ? Money.fromJSON(e.amount) : null,
          lines: (e.lines ?? []).map((l) => ({
            kind: chargeKind(l.kind),
            code: l.code,
            amount: Money.fromJSON(l.amount),
          })),
          provider: e.provider ?? null,
          reference: e.reference ?? null,
          method: e.method ?? null,
        },
      };
    }
    case "billing.statement_issued": {
      const s = statementIssued.parse(data);

      return {
        type,
        occurredAt: parseInstant(s.occurredAt),
        statement: {
          statementId: s.statementId,
          number: s.number,
          dueOn: parsePlainDate(s.dueOn),
          invoiceIds: s.invoiceIds,
        },
      };
    }
    case "distribution.commissions_recorded": {
      const c = commissionsRecorded.parse(data);

      if (!c.agencyId) return null;

      return {
        type,
        occurredAt: parseInstant(c.occurredAt),
        commissions: {
          policyId: c.policyId,
          agencyId: c.agencyId,
          commissionBasis: c.commissionBasis ?? null,
          lines: c.lines.map((l) => ({
            financialTransactionId: l.financialTransactionId,
            amount: Money.fromJSON(l.amount),
          })),
        },
      };
    }
    default:
      return null;
  }
}

/** The facts the native billing system wants from PAS (the same ones an external system gets). */
export const BILLING_FACT_TYPES = [
  "billing.invoice_issued",
  "billing.invoice_opened",
  "billing.event_applied",
  "billing.statement_issued",
  "distribution.commissions_recorded",
] as const;

import type { Money, PlainDate, TenantContext } from "@pas/kernel";
import type { BillingFact } from "../application/ingest-billing-fact";
import type { EntryActor } from "../domain/journal";

type MoneyJson = { amount: string; currency: string };

export type CanonicalEventType =
  | "payment.received"
  | "payment.reversed"
  | "refund.issued"
  | "credit.applied"
  | "credit.removed"
  | "writeoff.applied"
  | "writeoff.removed";

/** The canonical billing event, exactly as an external billing system would post it to PAS. */
export interface CanonicalBillingEvent {
  id: string;
  type: CanonicalEventType;
  occurredAt: string;
  invoiceId?: string;
  statementId?: string;
  amount?: MoneyJson;
  reference?: string;
  method?: { brand?: string; last4?: string };
  creditNoteId?: string;
  reason?: string;
}

export interface PasInvoiceBalance {
  invoiceId: string;
  number: string;
  kind: "invoice" | "credit_note";
  policyId: string;
  policyNumber: string;
  payer: string;
  payerRef: string | null;
  payerName: string | null;
  currency: string;
  total: Money;
  balance: Money;
  issuedOn: PlainDate;
  dueOn: PlainDate;
  status: string;
  installmentFee: Money;
  /** The installment fee on an installment not yet billed: not owed until it bills. */
  unbilledFee: Money;
}

/** PAS billing as the native billing system sees it: its open balances, and where events go. */
export interface PasBilling {
  invoices(ctx: TenantContext): Promise<PasInvoiceBalance[]>;
  /** PAS's outbound billing facts rebuilt from its records, invoices first, for catching up. */
  history(ctx: TenantContext): Promise<BillingFact[]>;
  /** Applies events through PAS's one billing-event path, now; idempotent by event id. */
  apply(
    ctx: TenantContext,
    events: readonly CanonicalBillingEvent[],
    actor: EntryActor,
  ): Promise<void>;
}

/** Refunds a captured card payment through the tenant's payment provider. */
export interface CardRefunds {
  refund(
    ctx: TenantContext,
    input: { paymentRef: string; amount: Money; idempotencyKey: string },
  ): Promise<{ refundId: string; provider: string }>;
}

import type { Instant, Money, TenantContext, Transaction } from "@pas/kernel";
import type { Quote, QuoteId } from "../domain/quote";
import type { QuoteActivity } from "../domain/quote-activity";
import type { SubmissionId } from "../domain/submission";

export interface PaymentAttempt {
  id: string;
  quoteId: QuoteId;
  provider: string;
  providerRef: string | null;
  status: "authorized" | "captured" | "declined" | "voided";
  amount: Money;
  method: { brand: string; last4: string; expMonth: number; expYear: number };
  failure: string | null;
  recordedAt: Instant;
}

export interface QuoteRepository {
  save(tx: Transaction, quote: Quote): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: QuoteId): Promise<Quote | null>;
  findBySubmission(
    tx: Transaction,
    ctx: TenantContext,
    submissionId: SubmissionId,
  ): Promise<Quote | null>;
  listBySubmissions(
    tx: Transaction,
    ctx: TenantContext,
    submissionIds: readonly SubmissionId[],
  ): Promise<Quote[]>;
  /** Pre-bind history, oldest first. `save` appends whatever the quote recorded since. */
  listActivity(tx: Transaction, ctx: TenantContext, id: QuoteId): Promise<QuoteActivity[]>;
  savePayment(tx: Transaction, ctx: TenantContext, payment: PaymentAttempt): Promise<void>;
}

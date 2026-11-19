import type { TenantContext } from "@pas/kernel";
import type {
  InvoiceSnapshot,
  ObligationSnapshot,
  PolicySnapshot,
  QuoteSnapshot,
  SubmissionSnapshot,
} from "../application/payloads";

/** Compact snapshots of the records events are about, read through each context's public API. */
export interface EventSubjects {
  submission(
    ctx: TenantContext,
    id: string,
  ): Promise<{ submission: SubmissionSnapshot; quote: QuoteSnapshot | null } | null>;
  policy(ctx: TenantContext, id: string): Promise<PolicySnapshot | null>;
  invoice(ctx: TenantContext, id: string): Promise<InvoiceSnapshot | null>;
  obligation(ctx: TenantContext, id: string): Promise<ObligationSnapshot | null>;
}

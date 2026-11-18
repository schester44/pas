import type { InvoiceDto } from "@pas/billing";
import type { TenantContext } from "@pas/kernel";
import type { PolicyDetailDto, PolicySummaryDto } from "@pas/policy";

/** Policies by ID, already narrowed to the caller's client scope. */
export interface PolicyDirectory {
  list(ctx: TenantContext, policyIds: readonly string[]): Promise<PolicySummaryDto[]>;
  detail(ctx: TenantContext, policyIds: readonly string[], id: string): Promise<PolicyDetailDto>;
  document(
    ctx: TenantContext,
    policyIds: readonly string[],
    input: { policyId: string; documentId: string },
  ): Promise<{ title: string; fileName: string; body: Uint8Array }>;
  changeRequests(
    ctx: TenantContext,
    policyIds: readonly string[],
    policyId: string,
  ): Promise<{ id: string; kind: string; details: string; status: string; createdAt: string }[]>;
  requestChange(
    ctx: TenantContext,
    policyIds: readonly string[],
    input: {
      policyId: string;
      kind: string;
      details: string;
      requester: { userId: string; name: string; email: string };
    },
  ): Promise<{ id: string }>;
}

export type CardInput = {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
  postalCode?: string;
};

export interface BillingDirectory {
  invoices(ctx: TenantContext, policyIds: readonly string[]): Promise<InvoiceDto[]>;
  invoice(ctx: TenantContext, id: string): Promise<InvoiceDto | null>;
  pay(
    ctx: TenantContext,
    input: {
      invoiceId: string;
      card: CardInput;
      actor: { type: "user"; id: string; name: string };
    },
  ): Promise<{ status: "paid"; invoice: InvoiceDto } | { status: "declined"; message: string }>;
}

/** "Your agent": the producer of record's contact details. */
export interface ProducerDirectory {
  contacts(
    producerIds: readonly string[],
  ): Promise<Map<string, { name: string; email: string | null }>>;
}

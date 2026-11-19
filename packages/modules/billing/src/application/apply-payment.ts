import { Money, type TenantContext } from "@pas/kernel";
import type { BillingTimelineEntry } from "../ports/policy-timeline";
import type { ApplyBillingEvent } from "./apply-billing-event";
import { type InvoiceDto, toInvoiceDto } from "./dto";

/** Money received against an invoice, as a `payment.received` event; idempotent on the reference. */
export function makeApplyPayment(deps: {
  applyEvent: ApplyBillingEvent;
  clocks: { forTenant(id: string): { now(): Temporal.Instant } };
}) {
  return async function applyPayment(
    ctx: TenantContext,
    input: {
      invoiceId: string;
      amount: { amount: string; currency: string };
      provider: string;
      providerRef: string;
      method: Record<string, unknown>;
      methodLabel?: string;
      actor: BillingTimelineEntry["actor"];
    },
  ): Promise<InvoiceDto> {
    const { invoice } = await deps.applyEvent(ctx, {
      eventId: `${input.provider}:${input.providerRef}`,
      source: "pas",
      type: "payment.received",
      occurredAt: deps.clocks.forTenant(ctx.tenantId).now(),
      invoiceId: input.invoiceId,
      amount: Money.of(input.amount.amount, input.amount.currency),
      provider: input.provider,
      reference: input.providerRef,
      method: input.method as { brand?: string; last4?: string },
      actor: input.actor,
    });

    return toInvoiceDto(invoice!);
  };
}

export type ApplyPayment = ReturnType<typeof makeApplyPayment>;

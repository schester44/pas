import {
  asId,
  type Clock,
  Money,
  newId,
  notFound,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { BillingTimelineEntry, PolicyTimeline } from "../ports/policy-timeline";
import { type InvoiceDto, toInvoiceDto } from "./dto";

/** Records money received against an invoice; idempotent on the provider's reference. */
export function makeApplyPayment(deps: {
  uow: UnitOfWork;
  invoices: InvoiceRepository;
  timeline: PolicyTimeline;
  clock: Clock;
}) {
  return async function applyPayment(
    ctx: TenantContext,
    input: {
      invoiceId: string;
      amount: { amount: string; currency: string };
      provider: string;
      providerRef: string;
      method: Record<string, unknown>;
      methodLabel: string;
      actor: BillingTimelineEntry["actor"];
    },
  ): Promise<InvoiceDto> {
    return deps.uow.run(ctx, async (tx) => {
      const invoice = await deps.invoices.findById(tx, ctx, asId(input.invoiceId));

      if (!invoice) throw notFound("Invoice", input.invoiceId);

      if (await deps.invoices.findPayment(tx, ctx, input.provider, input.providerRef)) {
        return toInvoiceDto(invoice);
      }

      const amount = Money.of(input.amount.amount, input.amount.currency);
      invoice.applyPayment(amount, deps.clock);
      const i = invoice.toSnapshot();

      await deps.invoices.save(tx, invoice);

      await deps.invoices.addPayment(tx, ctx, {
        id: newId(),
        policyId: i.policyId,
        invoiceId: invoice.id,
        provider: input.provider,
        providerRef: input.providerRef,
        method: input.method,
        amount,
        receivedAt: deps.clock.now(),
      });

      const formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: amount.currency,
      }).format(Number(amount.toString()));

      await deps.timeline.record(tx, ctx, {
        policyId: i.policyId,
        type: "payment_received",
        invoiceId: invoice.id,
        actor: input.actor,
        summary: `Payment of ${formatted} received by ${input.methodLabel} for ${i.number}`,
        data: {
          invoiceNumber: i.number,
          amount: amount.toJSON(),
          provider: input.provider,
          reference: input.providerRef,
          invoiceStatus: i.status,
        },
      });

      return toInvoiceDto(invoice);
    });
  };
}

export type ApplyPayment = ReturnType<typeof makeApplyPayment>;

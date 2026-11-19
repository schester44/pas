import {
  asId,
  Money,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
  type ProviderFor,
} from "@pas/kernel";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { PaymentGateway } from "../ports/payment-gateway";
import type { ApplyBillingEvent } from "./apply-billing-event";

/**
 * Pays a credit note back to the card that paid the policy, up to what was paid and not yet
 * refunded. Idempotent per credit note; a credit with nothing paid stays on account.
 */
export function makeRefundCreditNote(deps: {
  uow: UnitOfWork;
  invoices: InvoiceRepository;
  gateway: ProviderFor<PaymentGateway>;
  applyEvent: ApplyBillingEvent;
  clocks: ClockProvider;
}) {
  return async function refundCreditNote(
    ctx: TenantContext,
    input: { invoiceId: string },
  ): Promise<void> {
    const gateway = await deps.gateway.for(ctx);

    const plan = await deps.uow.run(ctx, async (tx) => {
      const credit = await deps.invoices.findById(tx, ctx, asId(input.invoiceId));

      if (!credit || credit.toSnapshot().kind !== "credit_note") return null;

      const c = credit.toSnapshot();
      const payments = await deps.invoices.listPayments(tx, ctx, c.policyId);

      if (payments.some((p) => p.kind === "refund" && p.invoiceId === c.id)) return null;

      const refundable = payments
        .filter((p) => p.provider === gateway.provider)
        .reduce((sum, p) => sum.plus(p.amount), Money.zero(c.total.currency));

      const source = payments.find((p) => p.kind === "payment" && p.provider === gateway.provider);

      if (!source) return null;

      const owed = credit.balance.negated();

      const amount = [owed, refundable, source.amount].reduce((a, b) =>
        a.amount.lessThan(b.amount) ? a : b,
      );

      if (!amount.amount.greaterThan(0)) return null;

      return { amount, source, number: c.number, policyId: c.policyId };
    });

    if (!plan) return;

    const { refundId } = await gateway.refund(ctx, {
      paymentRef: plan.source.providerRef,
      amount: plan.amount,
      idempotencyKey: `refund:${input.invoiceId}`,
    });

    const method = plan.source.method as { brand?: string; last4?: string };

    await deps.applyEvent(ctx, {
      eventId: `refund:${refundId}`,
      source: "pas",
      type: "refund.issued",
      occurredAt: deps.clocks.forTenant(ctx.tenantId).now(),
      invoiceId: input.invoiceId,
      amount: plan.amount,
      provider: gateway.provider,
      reference: refundId,
      method,
      actor: { type: "system", name: "Billing" },
    });
  };
}

export type RefundCreditNote = ReturnType<typeof makeRefundCreditNote>;

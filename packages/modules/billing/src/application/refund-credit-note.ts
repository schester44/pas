import {
  asId,
  Money,
  newId,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { PaymentGateway } from "../ports/payment-gateway";
import type { PolicyTimeline } from "../ports/policy-timeline";

const format = (money: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(
    Number(money.toString()),
  );

/**
 * Pays a credit note back to the card that paid the policy, up to what was paid and not yet
 * refunded. Idempotent per credit note; a credit with nothing paid stays on account.
 */
export function makeRefundCreditNote(deps: {
  uow: UnitOfWork;
  invoices: InvoiceRepository;
  gateway: PaymentGateway;
  timeline: PolicyTimeline;
  clocks: ClockProvider;
}) {
  return async function refundCreditNote(
    ctx: TenantContext,
    input: { invoiceId: string },
  ): Promise<void> {
    const plan = await deps.uow.run(ctx, async (tx) => {
      const credit = await deps.invoices.findById(tx, ctx, asId(input.invoiceId));

      if (!credit || credit.toSnapshot().kind !== "credit_note") return null;

      const c = credit.toSnapshot();
      const payments = await deps.invoices.listPayments(tx, ctx, c.policyId);

      if (payments.some((p) => p.kind === "refund" && p.invoiceId === c.id)) return null;

      const refundable = payments
        .filter((p) => p.provider === deps.gateway.provider)
        .reduce((sum, p) => sum.plus(p.amount), Money.zero(c.total.currency));

      const owed = credit.balance.negated();
      const amount = owed.amount.greaterThan(refundable.amount) ? refundable : owed;

      const source = payments.find(
        (p) => p.kind === "payment" && p.provider === deps.gateway.provider,
      );

      if (!amount.amount.isPositive() || !source) return null;

      return { amount, source, number: c.number, policyId: c.policyId };
    });

    if (!plan) return;

    const { refundId } = await deps.gateway.refund(ctx, {
      paymentRef: plan.source.providerRef,
      amount: plan.amount,
      idempotencyKey: `refund:${input.invoiceId}`,
    });

    await deps.uow.run(ctx, async (tx) => {
      const credit = (await deps.invoices.findById(tx, ctx, asId(input.invoiceId)))!;

      if (await deps.invoices.findPayment(tx, ctx, deps.gateway.provider, refundId)) return;

      credit.applyRefund(plan.amount, deps.clocks.forTenant(ctx.tenantId));
      await deps.invoices.save(tx, credit);

      await deps.invoices.addPayment(tx, ctx, {
        id: newId(),
        kind: "refund",
        policyId: plan.policyId,
        invoiceId: credit.id,
        provider: deps.gateway.provider,
        providerRef: refundId,
        method: { ...plan.source.method },
        amount: plan.amount.negated(),
        receivedAt: deps.clocks.forTenant(ctx.tenantId).now(),
      });

      const method = plan.source.method as { brand?: string; last4?: string };

      await deps.timeline.record(tx, ctx, {
        policyId: plan.policyId,
        type: "refund_issued",
        invoiceId: credit.id,
        actor: { type: "system", name: "Billing" },
        summary: `Refund of ${format(plan.amount)} issued${method.last4 ? ` to ${method.brand ?? "card"} ending ${method.last4}` : ""} for ${plan.number}`,
        data: { invoiceNumber: plan.number, amount: plan.amount.toJSON(), reference: refundId },
      });
    });
  };
}

export type RefundCreditNote = ReturnType<typeof makeRefundCreditNote>;

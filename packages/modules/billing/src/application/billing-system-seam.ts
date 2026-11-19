import {
  Money,
  parsePlainDate,
  type ProviderFor,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { BillingEvent } from "../domain/billing-event";
import type { BillingEventLog } from "../ports/billing-event-log";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { PaymentGateway } from "../ports/payment-gateway";
import { type ApplyBillingEvent, MONEY_EVENT_TYPES } from "./apply-billing-event";
import { toInvoiceDto } from "./dto";
import { type InboundBillingEvent, nativeBillingEventFrom } from "./inbound-event";
import type { ListInvoices } from "./list-invoices";

/**
 * What the native billing system may use of PAS billing (PLAN §13): the invoice balances it
 * reconciles against, the one billing-event path its canonical events are applied through, and
 * the card provider for refunds. Nothing else of PAS billing is reachable from it.
 */
export function makeBillingSystemSeam(deps: {
  uow: UnitOfWork;
  invoices: InvoiceRepository;
  events: BillingEventLog;
  listInvoices: ListInvoices;
  applyEvent: ApplyBillingEvent;
  gateway: ProviderFor<PaymentGateway>;
}) {
  return {
    /**
     * The outbound billing facts again, rebuilt from what PAS has: each invoice as issued and every
     * money event applied since. A billing system that missed a fact catches up from these.
     */
    async history(ctx: TenantContext) {
      return deps.uow.run(ctx, async (tx) => {
        const [invoices, applied] = await Promise.all([
          deps.invoices.listAll(tx, ctx),
          deps.events.listApplied(tx, ctx),
        ]);

        return {
          invoices: invoices.map((invoice) => {
            const i = invoice.toSnapshot();

            return {
              occurredAt: i.createdAt.toString(),
              invoice: {
                ...toInvoiceDto(invoice),
                jurisdiction: null,
                currency: i.total.currency,
                lines: i.lines
                  .filter((line) => !line.transactionId)
                  .map((line) => ({
                    kind: line.kind,
                    code: line.code,
                    amount: line.amount.toJSON(),
                  })),
              },
            };
          }),
          opened: invoices
            .filter(
              (invoice) =>
                invoice.toSnapshot().kind === "invoice" &&
                invoice.status !== "scheduled" &&
                invoice.status !== "void",
            )
            .map((invoice) => {
              const i = invoice.toSnapshot();

              return {
                occurredAt: i.updatedAt.toString(),
                invoiceId: i.id,
                billedOn: i.issuedOn.toString(),
                fee: invoice.installmentFee.toJSON(),
              };
            }),
          events: applied
            .filter((e) => MONEY_EVENT_TYPES.has(e.type))
            .map((e) => ({
              ...e.payload,
              appliedAt: e.occurredAt.toString(),
              eventId: e.eventId,
              source: e.source,
              type: e.type,
              invoiceId: e.invoiceId,
            })),
        };
      });
    },

    async invoices(ctx: TenantContext) {
      return (await deps.listInvoices.all(ctx)).map((i) => {
        const fee = i.lines
          .filter((l) => l.kind === "installment_fee")
          .reduce(
            (sum, l) => sum.plus(Money.of(l.amount.amount, l.amount.currency)),
            Money.zero(i.total.currency),
          );

        return {
          invoiceId: i.id,
          number: i.number,
          kind: i.kind,
          policyId: i.policyId,
          policyNumber: i.policyNumber,
          payer: i.payer,
          payerRef: i.payerRef,
          payerName: i.payerName,
          currency: i.total.currency,
          total: Money.of(i.total.amount, i.total.currency),
          balance: Money.of(i.balance.amount, i.balance.currency),
          issuedOn: parsePlainDate(i.issuedOn),
          dueOn: parsePlainDate(i.dueOn),
          status: i.status,
          installmentFee: fee,
          unbilledFee: i.status === "scheduled" ? fee : Money.zero(i.total.currency),
        };
      });
    },

    async apply(
      ctx: TenantContext,
      events: readonly InboundBillingEvent[],
      actor: { type: BillingEvent["actor"]["type"]; id?: string | null; name: string },
    ) {
      for (const event of events) {
        await deps.applyEvent(
          ctx,
          nativeBillingEventFrom(event, {
            type: actor.type,
            name: actor.name,
            ...(actor.id && { id: actor.id }),
          }),
        );
      }
    },

    async refund(
      ctx: TenantContext,
      input: { paymentRef: string; amount: Money; idempotencyKey: string },
    ) {
      const gateway = await deps.gateway.for(ctx);
      const { refundId } = await gateway.refund(ctx, input);

      return { refundId, provider: gateway.provider };
    },
  };
}

export type BillingSystemSeam = ReturnType<typeof makeBillingSystemSeam>;

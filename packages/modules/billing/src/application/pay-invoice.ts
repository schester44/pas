import { asId, conflict, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { BillingTimelineEntry } from "../ports/policy-timeline";
import type { CardMethod, PaymentGateway } from "../ports/payment-gateway";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { ApplyPayment } from "./apply-payment";
import type { InvoiceDto } from "./dto";

export type PayInvoiceResult =
  | { status: "paid"; invoice: InvoiceDto }
  | { status: "declined"; message: string };

/** Pays an invoice's balance by card: authorize, capture, then apply to the invoice. */
export function makePayInvoice(deps: {
  uow: UnitOfWork;
  invoices: InvoiceRepository;
  gateway: PaymentGateway;
  applyPayment: ApplyPayment;
}) {
  return async function payInvoice(
    ctx: TenantContext,
    input: { invoiceId: string; card: CardMethod; actor: BillingTimelineEntry["actor"] },
  ): Promise<PayInvoiceResult> {
    const invoice = await deps.uow.run(ctx, (tx) =>
      deps.invoices.findById(tx, ctx, asId(input.invoiceId)),
    );

    if (!invoice) throw notFound("Invoice", input.invoiceId);

    const i = invoice.toSnapshot();
    const balance = invoice.balance;

    if (i.kind !== "invoice" || i.status === "void" || !balance.amount.isPositive()) {
      throw conflict(`${i.number} has nothing to pay`);
    }

    const authorization = await deps.gateway.authorize(ctx, {
      reference: i.number,
      idempotencyKey: `${i.id}:${i.amountPaid.toString()}`,
      amount: balance,
      method: input.card,
    });

    if (authorization.status === "declined") {
      return { status: "declined", message: authorization.message };
    }

    await deps.gateway.capture(ctx, {
      authorizationId: authorization.authorizationId,
      amount: balance,
    });

    const paid = await deps.applyPayment(ctx, {
      invoiceId: i.id,
      amount: balance.toJSON(),
      provider: deps.gateway.provider,
      providerRef: authorization.authorizationId,
      method: { ...authorization.method },
      methodLabel: `${authorization.method.brand} ending ${authorization.method.last4}`,
      actor: input.actor,
    });

    return { status: "paid", invoice: paid };
  };
}

export type PayInvoice = ReturnType<typeof makePayInvoice>;

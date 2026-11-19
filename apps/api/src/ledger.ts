import {
  type ApplyBillingEvent,
  type BillingEventLog,
  type InvoiceRepository,
  type ApplyPayment,
  type ListInvoices,
  makeBillingSystemSeam,
  type PaymentGateway,
} from "@pas/billing";
import type { CommissionFacts } from "@pas/distribution";
import type { ProviderResolver } from "@pas/integrations";
import { NATIVE_BILLING } from "@pas/integrations/infrastructure";
import {
  type ClockProvider,
  DomainError,
  Money,
  type Outbox,
  type ProviderFor,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { composeLedger } from "@pas/ledger/infrastructure";

/** The native billing system in the API (PLAN §13), and the switch between it and an external one. */
export function composeApiLedger(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  listInvoices: ListInvoices;
  commissionFacts: CommissionFacts;
  invoices: InvoiceRepository;
  billingEvents: BillingEventLog;
  applyEvent: ApplyBillingEvent;
  payments: ProviderFor<PaymentGateway>;
  resolver: Pick<ProviderResolver, "primary" | "isSandbox">;
}) {
  const seam = makeBillingSystemSeam({
    uow: deps.uow,
    invoices: deps.invoices,
    events: deps.billingEvents,
    listInvoices: deps.listInvoices,
    applyEvent: deps.applyEvent,
    gateway: deps.payments,
  });

  const ledger = composeLedger({
    uow: deps.uow,
    outbox: deps.outbox,
    clocks: deps.clocks,
    pas: {
      ...seam,
      history: async (ctx) => ({
        ...(await seam.history(ctx)),
        commissions: await deps.commissionFacts(ctx),
      }),
    },
    cards: seam,
  });

  const isNative = async (ctx: TenantContext) =>
    (await deps.resolver.primary(ctx, "billing")).providerId === NATIVE_BILLING;

  /**
   * Card charges post through the ledger when the tenant bills natively. An invoice the ledger
   * hasn't booked yet (bound a moment ago) takes PAS's own path; the ledger mirrors it from the
   * billing facts, under the same event id.
   */
  const cardPaymentsThroughLedger =
    (applyPayment: ApplyPayment): ApplyPayment =>
    async (ctx, input) => {
      if (!(await isNative(ctx))) return applyPayment(ctx, input);

      try {
        await ledger.recordCardPayment(ctx, {
          invoiceId: input.invoiceId,
          amount: Money.of(input.amount.amount, input.amount.currency),
          provider: input.provider,
          providerRef: input.providerRef,
          method: input.method as { brand?: string; last4?: string },
          actor: { type: input.actor.type, id: input.actor.id ?? null, name: input.actor.name },
        });
      } catch (error) {
        if (!(error instanceof DomainError && error.code === "not_found")) throw error;

        return applyPayment(ctx, input);
      }

      const invoice = await deps.listInvoices.byId(ctx, { id: input.invoiceId });

      if (!invoice) throw new DomainError("not_found", `Invoice ${input.invoiceId} not found`);

      return invoice;
    };

  /** Simulated billing events only stand in for an external billing system, and only in sandboxes. */
  const simulationAvailable = async (ctx: TenantContext) =>
    !(await isNative(ctx)) && (await deps.resolver.isSandbox(ctx.tenantId));

  return { ledger, isNative, cardPaymentsThroughLedger, simulationAvailable };
}

export type ApiLedger = ReturnType<typeof composeApiLedger>;

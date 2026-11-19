import {
  type ApplyBillingEvent,
  type BillingEventLog,
  type InvoiceRepository,
  type InboundBillingEvent,
  type ListInvoices,
  makeBillingSystemSeam,
  nativeBillingEventFrom,
  type PaymentGateway,
} from "@pas/billing";
import type { CommissionFacts } from "@pas/distribution";
import type { ProviderResolver } from "@pas/integrations";
import { NATIVE_BILLING } from "@pas/integrations/infrastructure";
import {
  asId,
  type ClockProvider,
  defineWorkflow,
  type Outbox,
  type ProviderFor,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { type EntryActor, reconciliationWorkflow } from "@pas/ledger";
import { BILLING_FACT_TYPES, composeLedger } from "@pas/ledger/infrastructure";
import type { Logger } from "@pas/observability";
import type { DomainEventHandler } from "./handlers/domain-events";

const contextOf = (tenantId: string): TenantContext => ({
  tenantId: asId<"Tenant">(tenantId),
  actor: { type: "system", process: "native-billing" },
});

/**
 * The native billing system in the worker (PLAN §13): PAS's outbound billing facts go to the
 * tenant's billing provider (this ledger, or an external system), the ledger's canonical events
 * come back through the one billing-event path, and a daily reconciliation runs per tenant.
 */
export function composeWorkerLedger(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  logger: Logger;
  listInvoices: ListInvoices;
  commissionFacts: CommissionFacts;
  invoices: InvoiceRepository;
  billingEvents: BillingEventLog;
  applyEvent: ApplyBillingEvent;
  payments: ProviderFor<PaymentGateway>;
  resolver: () => Pick<ProviderResolver, "primary">;
  ledgerTenants: () => Promise<string[]>;
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
    (await deps.resolver().primary(ctx, "billing")).providerId === NATIVE_BILLING;

  /** What `builtinProviders` needs to make the native billing system an integrations provider. */
  const nativeBilling = {
    async publish(tenantId: string, type: string, data: Record<string, unknown>) {
      const ctx = contextOf(tenantId);
      const result = await ledger.ingest(ctx, type, data);

      if (result.posted) deps.logger.info({ type, tenantId }, "ledger posted a billing fact");
    },
  };

  const publishFact: DomainEventHandler = async (event) => {
    const ctx = contextOf(event.tenantId);
    const billing = await deps.resolver().primary(ctx, "billing");

    await billing.adapter.publish(event.type, event.payload as Record<string, unknown>);
  };

  const handlers: Record<string, DomainEventHandler[]> = {
    ...Object.fromEntries(BILLING_FACT_TYPES.map((type) => [type, [publishFact]])),
    "ledger.billing_event": [
      async (event) => {
        const ctx = contextOf(event.tenantId);

        const { event: inbound, actor } = event.payload as {
          event: InboundBillingEvent;
          actor: EntryActor;
        };

        if (!(await isNative(ctx))) return;

        await deps.applyEvent(
          ctx,
          nativeBillingEventFrom(inbound, {
            type: actor.type,
            name: actor.name,
            ...(actor.id && { id: actor.id }),
          }),
        );
      },
    ],
  };

  const reconcile = async (ctx: TenantContext) => {
    if (!(await isNative(ctx))) return null;

    const result = await ledger.reconcile(ctx);
    const run = { status: result.status, differences: result.differences.length };

    if (run.status !== "balanced") {
      deps.logger.warn(
        { tenantId: ctx.tenantId, ...run },
        "ledger reconciliation found differences",
      );
    }

    return run;
  };

  /** Runs left over from the per-day reconciliation chain reconcile once and end. */
  const workflow = defineWorkflow(reconciliationWorkflow, async ({ tenantId, step }) => {
    const run = await step.run("reconcile", () => reconcile(contextOf(tenantId)));

    return run ?? { status: "skipped" };
  });

  /** The nightly sweep (PLAN §5.5): every tenant with an open ledger, or the one asked for. */
  const reconcileAll = async (tenantId: string | null) => {
    const tenants = tenantId ? [tenantId] : await deps.ledgerTenants();

    for (const id of tenants) {
      await reconcile(contextOf(id)).catch((error: unknown) =>
        deps.logger.warn({ tenantId: id, err: error }, "ledger reconciliation failed"),
      );
    }
  };

  return { ledger, nativeBilling, handlers, reconcileAll, workflows: [workflow] };
}

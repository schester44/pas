import {
  asId,
  type Money,
  newId,
  notFound,
  invalid,
  type Outbox,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { BillingEvent } from "../domain/billing-event";
import type { Invoice } from "../domain/invoice";
import type { BillingEventLog } from "../ports/billing-event-log";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { BillingTimelineEntry, PolicyTimeline } from "../ports/policy-timeline";

export interface BillingEventDeps {
  invoices: InvoiceRepository;
  events: BillingEventLog;
  timeline: PolicyTimeline;
  outbox: Outbox;
  clocks: ClockProvider;
}

export const formatMoney = (money: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(
    Number(money.toString()),
  );

const methodLabel = (event: BillingEvent) =>
  event.method?.last4
    ? `${event.method.brand ?? "Card"} ending ${event.method.last4}`
    : event.source.startsWith("install:")
      ? `the billing system${event.reference ? ` (${event.reference})` : ""}`
      : (event.provider ?? event.source);

/**
 * The one path for money on a PAS invoice (PLAN §13): every payment, failure, reversal, refund,
 * credit, write-off and adjustment, from PAS's own flows or a billing system, is applied here.
 * Idempotent by (source, event id). Runs inside the caller's transaction.
 */
export async function applyBillingEventIn(
  deps: BillingEventDeps,
  tx: Transaction,
  ctx: TenantContext,
  event: BillingEvent,
): Promise<{ applied: boolean; invoice: Invoice | null }> {
  const clock = deps.clocks.forTenant(ctx.tenantId);

  const invoice = event.invoiceId
    ? await deps.invoices.findById(tx, ctx, asId(event.invoiceId))
    : null;

  if (event.invoiceId && !invoice) throw notFound("Invoice", event.invoiceId);

  const policyId =
    invoice?.toSnapshot().policyId ??
    (event.policyNumber ? await deps.events.findPolicyByNumber(tx, ctx, event.policyNumber) : null);

  if (!policyId) throw invalid("A billing event names an invoice or a policy number");

  const fresh = await deps.events.record(tx, ctx, {
    ...event,
    invoiceId: invoice?.id ?? null,
    policyId,
  });

  if (!fresh) return { applied: false, invoice };

  const amount = () => {
    if (!event.amount) throw invalid(`${event.type} needs an amount`);

    return event.amount;
  };

  const i = () => {
    if (!invoice) throw invalid(`${event.type} needs an invoice`);

    return invoice;
  };

  const number = invoice?.toSnapshot().number ?? "";

  const log = async (entry: Omit<BillingTimelineEntry, "policyId" | "actor" | "invoiceId">) => {
    if (event.quiet) return;

    await deps.timeline.record(tx, ctx, {
      ...entry,
      policyId,
      actor: event.actor,
      ...(invoice && { invoiceId: invoice.id }),
      data: {
        ...entry.data,
        billingEvent: { type: event.type, id: event.eventId, source: event.source },
      },
    });
  };

  const emit = (type: string, payload: Record<string, unknown>) =>
    deps.outbox.add(tx, [
      {
        id: newId(),
        type,
        tenantId: ctx.tenantId,
        aggregateType: "invoice",
        aggregateId: invoice?.id ?? policyId,
        occurredAt: clock.now(),
        payload: { policyId, ...(invoice && { invoiceId: invoice.id }), ...payload },
      },
    ]);

  const payment = (kind: "payment" | "refund" | "reversal", value: Money) =>
    deps.invoices.addPayment(tx, ctx, {
      id: newId(),
      kind,
      policyId,
      invoiceId: i().id,
      provider: event.provider ?? event.source,
      providerRef:
        kind === "reversal" ? `reversal:${event.eventId}` : (event.reference ?? event.eventId),
      method: { ...event.method },
      amount: value,
      receivedAt: event.occurredAt,
    });

  const balanceChanged = () => emit("billing.balance_changed", { cause: event.type });

  switch (event.type) {
    case "payment.received": {
      i().applyPayment(amount(), clock);
      await payment("payment", amount());

      await log({
        type: "payment_received",
        summary: `Payment of ${formatMoney(amount())} received by ${methodLabel(event)} for ${number}`,
        data: {
          invoiceNumber: number,
          amount: amount().toJSON(),
          provider: event.provider ?? event.source,
          reference: event.reference ?? null,
          invoiceStatus: i().status,
        },
      });

      await balanceChanged();
      break;
    }
    case "payment.failed": {
      await log({
        type: "payment_failed",
        summary: `Payment${event.amount ? ` of ${formatMoney(event.amount)}` : ""} by ${methodLabel(event)} failed${number ? ` for ${number}` : ""}${event.reason ? `: ${event.reason}` : ""}`,
        data: {
          invoiceNumber: number,
          reason: event.reason ?? null,
          amount: event.amount?.toJSON() ?? null,
        },
      });

      await emit("billing.payment_failed", { reason: event.reason ?? null });
      break;
    }
    case "payment.reversed": {
      i().reversePayment(amount(), clock);
      await payment("reversal", amount().negated());

      await log({
        type: "payment_reversed",
        summary: `Payment of ${formatMoney(amount())} for ${number} was reversed${event.reason ? `: ${event.reason}` : ""}`,
        data: { invoiceNumber: number, amount: amount().toJSON(), reason: event.reason ?? null },
      });

      await balanceChanged();
      break;
    }
    case "refund.issued": {
      i().drawCredit(amount(), clock);
      await payment("refund", amount().negated());

      await log({
        type: "refund_issued",
        summary: `Refund of ${formatMoney(amount())} issued${event.method?.last4 ? ` to ${methodLabel(event)}` : ""} for ${number}`,
        data: {
          invoiceNumber: number,
          amount: amount().toJSON(),
          reference: event.reference ?? null,
        },
      });

      break;
    }
    case "credit.applied":
    case "credit.removed": {
      const credit = event.creditNoteId
        ? await deps.invoices.findById(tx, ctx, asId(event.creditNoteId))
        : null;

      const applied = event.type === "credit.applied";

      if (applied) i().applyCredit(amount(), clock);
      else i().removeCredit(amount(), clock);

      if (credit) {
        if (applied) credit.drawCredit(amount(), clock);
        else credit.restoreCredit(amount(), clock);

        await deps.invoices.save(tx, credit);
      }

      const from = credit ? ` from ${credit.toSnapshot().number}` : "";

      await log({
        type: "credit_applied",
        summary: applied
          ? `Credit of ${formatMoney(amount())}${from} applied to ${number}`
          : `Credit of ${formatMoney(amount())} removed from ${number}`,
        data: { invoiceNumber: number, amount: amount().toJSON(), removed: !applied },
      });

      await balanceChanged();
      break;
    }
    case "writeoff.applied":
    case "writeoff.removed": {
      const applied = event.type === "writeoff.applied";

      if (applied) i().writeOff(amount(), clock);
      else i().removeWriteOff(amount(), clock);

      await log({
        type: "write_off",
        summary: applied
          ? `${formatMoney(amount())} written off ${number}`
          : `Write-off of ${formatMoney(amount())} on ${number} removed`,
        data: { invoiceNumber: number, amount: amount().toJSON(), removed: !applied },
      });

      await balanceChanged();
      break;
    }
    case "invoice.adjusted": {
      const lines = event.lines ?? [];

      i().adjust(lines, clock);

      await log({
        type: "invoice_adjusted",
        summary: `${number} adjusted: ${lines.map((l) => `${l.label} ${formatMoney(l.amount)}`).join(", ")}`,
        data: {
          invoiceNumber: number,
          lines: lines.map((l) => ({ code: l.code, label: l.label, amount: l.amount.toJSON() })),
          total: i().toSnapshot().total.toJSON(),
        },
      });

      await balanceChanged();
      break;
    }
    case "account.delinquent": {
      await log({
        type: "delinquent",
        summary: `Account delinquent${event.amount ? `: ${formatMoney(event.amount)} past due` : ""}`,
        data: { amount: event.amount?.toJSON() ?? null, invoiceNumber: number || null },
      });

      await emit("billing.account_delinquent", { amount: event.amount?.toJSON() ?? null });
      break;
    }
    case "account.current": {
      await log({ type: "account_current", summary: "Account brought current", data: {} });
      await emit("billing.account_current", {});
      break;
    }
    case "payment_method.updated": {
      await log({
        type: "autopay_updated",
        summary: event.reason ?? `Payment method updated to ${methodLabel(event)}`,
        data: { method: { ...event.method } },
      });

      break;
    }
  }

  if (invoice) await deps.invoices.save(tx, invoice);

  return { applied: true, invoice };
}

/** Applies one billing event in its own unit of work (built-in flows and inbound billing events). */
export function makeApplyBillingEvent(deps: BillingEventDeps & { uow: UnitOfWork }) {
  return (ctx: TenantContext, event: BillingEvent) =>
    deps.uow.run(ctx, (tx) => applyBillingEventIn(deps, tx, ctx, event));
}

export type ApplyBillingEvent = ReturnType<typeof makeApplyBillingEvent>;

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
import type { AgencyStatementRepository } from "../ports/agency-statement-repository";
import type { BillingEventLog } from "../ports/billing-event-log";
import type { MortgageeBillRepository } from "../ports/mortgagee-bill-repository";
import type { InvoiceRepository } from "../ports/invoice-repository";
import type { BillingTimelineEntry, PolicyTimeline } from "../ports/policy-timeline";

export interface BillingEventDeps {
  invoices: InvoiceRepository;
  events: BillingEventLog;
  timeline: PolicyTimeline;
  outbox: Outbox;
  clocks: ClockProvider;
  statements?: AgencyStatementRepository;
  mortgageeBills?: MortgageeBillRepository;
}

export const formatMoney = (money: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(
    Number(money.toString()),
  );

/** Events that move money on an invoice; each is published as `billing.event_applied` for the billing system. */
export const MONEY_EVENT_TYPES: ReadonlySet<string> = new Set<BillingEvent["type"]>([
  "payment.received",
  "payment.reversed",
  "refund.issued",
  "credit.applied",
  "credit.removed",
  "writeoff.applied",
  "writeoff.removed",
  "invoice.adjusted",
]);

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
  if (event.statementId && !event.invoiceId) {
    return { applied: await applyStatementEventIn(deps, tx, ctx, event), invoice: null };
  }

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
          ? `Credit of ${formatMoney(amount())}${from} applied to ${number}${event.reason ? ` (${event.reason})` : ""}`
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

  if (invoice && MONEY_EVENT_TYPES.has(event.type)) {
    await emit("billing.event_applied", {
      appliedAt: clock.now().toString(),
      eventId: event.eventId,
      source: event.source,
      type: event.type,
      creditNoteId: event.creditNoteId ?? null,
      amount: event.amount?.toJSON() ?? null,
      lines: (event.lines ?? []).map((l) => ({
        kind: l.kind,
        code: l.code,
        amount: l.amount.toJSON(),
      })),
      provider: event.provider ?? null,
      reference: event.reference ?? null,
      method: event.method ? { ...event.method } : null,
    });
  }

  if (invoice && !invoice.isUnpaid && deps.mortgageeBills) {
    const bill = await deps.mortgageeBills.findByInvoice(tx, ctx, invoice.id);

    if (bill?.markPaid(clock.today("UTC"), clock)) await deps.mortgageeBills.save(tx, ctx, bill);
  }

  return { applied: true, invoice };
}

/**
 * A remittance (or its reversal) against an agency's account current: applied across the
 * statement's items, each through the invoice path. A fully paid item's invoice is settled with
 * a credit for what the agency kept (commission) or what returns already netted.
 */
async function applyStatementEventIn(
  deps: BillingEventDeps,
  tx: Transaction,
  ctx: TenantContext,
  event: BillingEvent,
): Promise<boolean> {
  if (!deps.statements) throw invalid("Agency statements aren't available here");

  const statement = await deps.statements.findById(tx, ctx, event.statementId!);

  if (!statement) throw notFound("Agency statement", event.statementId!);

  if (event.type !== "payment.received" && event.type !== "payment.reversed") {
    throw invalid("Statement events are payment.received or payment.reversed");
  }

  if (!event.amount) throw invalid(`${event.type} needs an amount`);

  const fresh = await deps.events.record(tx, ctx, { ...event, invoiceId: null, policyId: null });

  if (!fresh) return false;

  const clock = deps.clocks.forTenant(ctx.tenantId);
  const s = statement.toSnapshot();
  const reference = `account current ${s.number}`;
  const item = (id: string) => statement.items.find((i) => i.id === id)!;

  const invoiceEvent = (suffix: string, rest: Partial<BillingEvent> & Pick<BillingEvent, "type">) =>
    applyBillingEventIn(deps, tx, ctx, {
      ...rest,
      eventId: `${event.eventId}:${suffix}`,
      source: event.source,
      occurredAt: event.occurredAt,
      ...(event.provider && { provider: event.provider }),
      ...(event.reason && { reason: event.reason }),
      actor: event.actor,
    });

  if (event.type === "payment.received") {
    for (const allocation of statement.applyPayment(event.amount, clock)) {
      const invoice = await deps.invoices.findById(tx, ctx, asId(allocation.invoiceId));
      const cash = invoice ? minOf(allocation.amount, invoice.balance) : null;

      if (cash?.amount.greaterThan(0)) {
        await invoiceEvent(allocation.itemId, {
          type: "payment.received",
          invoiceId: allocation.invoiceId,
          amount: cash,
          reference: `${event.reference ? `${event.reference}, ` : ""}${reference}, ${item(allocation.itemId).invoiceNumber}`,
        });
      }

      if (!allocation.settled) continue;

      const after = await deps.invoices.findById(tx, ctx, asId(allocation.invoiceId));
      const rest = after?.isUnpaid ? after.balance : null;

      if (!rest?.amount.greaterThan(0)) continue;

      await invoiceEvent(`${allocation.itemId}:settle`, {
        type: "credit.applied",
        invoiceId: allocation.invoiceId,
        amount: rest,
        reason: `Settled on ${reference}`,
      });

      statement.recordSettlementCredit(allocation.itemId, rest, clock);
    }
  } else {
    const today = clock.today("UTC");

    for (const reversal of statement.reversePayment(event.amount, today, clock)) {
      const settlement = item(reversal.itemId).settlementCredit;

      if (reversal.settled && settlement.amount.greaterThan(0)) {
        await invoiceEvent(`${reversal.itemId}:unsettle`, {
          type: "credit.removed",
          invoiceId: reversal.invoiceId,
          amount: settlement,
        });

        statement.recordSettlementCredit(reversal.itemId, settlement.minus(settlement), clock);
      }

      const invoice = await deps.invoices.findById(tx, ctx, asId(reversal.invoiceId));
      const paid = invoice ? minOf(reversal.amount, invoice.toSnapshot().amountPaid) : null;

      if (paid?.amount.greaterThan(0)) {
        await invoiceEvent(reversal.itemId, {
          type: "payment.reversed",
          invoiceId: reversal.invoiceId,
          amount: paid,
        });
      }
    }
  }

  await deps.statements.save(tx, ctx, statement);

  await deps.outbox.add(tx, [
    {
      id: newId(),
      type: "billing.agency_statement_changed",
      tenantId: ctx.tenantId,
      aggregateType: "agency_statement",
      aggregateId: statement.id,
      occurredAt: clock.now(),
      payload: {
        statementId: statement.id,
        agencyId: s.agencyId,
        status: statement.status,
        cause: event.type,
      },
    },
  ]);

  return true;
}

const minOf = (a: Money, b: Money) => (a.amount.lessThan(b.amount) ? a : b);

/** Applies one billing event in its own unit of work (built-in flows and inbound billing events). */
export function makeApplyBillingEvent(deps: BillingEventDeps & { uow: UnitOfWork }) {
  return (ctx: TenantContext, event: BillingEvent) =>
    deps.uow.run(ctx, (tx) => applyBillingEventIn(deps, tx, ctx, event));
}

export type ApplyBillingEvent = ReturnType<typeof makeApplyBillingEvent>;

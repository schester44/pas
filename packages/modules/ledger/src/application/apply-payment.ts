import {
  conflict,
  invalid,
  type Money,
  newId,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { type Allocation, allocateOldestFirst, checkAllocations } from "../domain/allocation";
import type { Payment } from "../domain/payment";
import { applicationLines, negate } from "../domain/posting-rules";
import type { CanonicalBillingEvent } from "../ports/pas-billing";
import type { ReceivableRecord } from "../ports/repositories";
import {
  audit,
  clockOf,
  type CommandMeta,
  eventKey,
  type LedgerDeps,
  NATIVE_SOURCE,
  post,
  runCommand,
  todayOf,
} from "./deps";
import type { OpenLedger } from "./open-ledger";

export type ApplyTarget =
  | { kind: "invoices"; allocations: { invoiceId: string; amount: Money }[] }
  | { kind: "oldest_first"; invoiceIds?: string[] }
  | { kind: "statement"; statementId: string; amount: Money };

export async function loadPayment(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Payment> {
  const payment = await deps.payments.find(tx, ctx, id);

  if (!payment) throw notFound("Payment", id);

  return payment;
}

async function openReceivables(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  invoiceIds: readonly string[],
) {
  const balances = await deps.receivables.balances(tx, ctx, { invoiceIds });
  const records = new Map<string, ReceivableRecord>();

  for (const id of invoiceIds) {
    const record = await deps.receivables.find(tx, ctx, id);

    if (!record) throw notFound("Invoice", id);

    records.set(id, record);
  }

  return { balances, records };
}

const reference = (payment: Payment) => {
  const p = payment.toSnapshot();

  return p.reference ? `${p.number}, ${p.reference}` : p.number;
};

/**
 * Applies part of a payment to invoices (staff's split, or oldest due first) or to an agency's
 * statement. Each invoice application is a journal entry and a `payment.received` for PAS; a
 * statement remittance goes to PAS as one statement event, which PAS spreads over the items.
 */
export async function applyIn(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  payment: Payment,
  target: ApplyTarget,
  meta: CommandMeta,
): Promise<CanonicalBillingEvent[]> {
  const clock = clockOf(deps, ctx);
  const now = clock.now().toString();

  if (target.kind === "statement") {
    if (target.amount.amount.greaterThan(payment.unapplied.amount)) {
      throw conflict(
        `${payment.toSnapshot().number} has only ${payment.unapplied.toString()} unapplied`,
      );
    }

    await audit(deps, tx, ctx, meta, {
      action: "payment.applied_to_statement",
      entityType: "payment",
      entityId: payment.id,
      after: { statementId: target.statementId, amount: target.amount.toJSON() },
    });

    return [
      {
        id: `ledger:stmt:${payment.id}:${newId()}`,
        type: "payment.received",
        occurredAt: now,
        statementId: target.statementId,
        amount: target.amount.toJSON(),
        reference: reference(payment),
      },
    ];
  }

  let allocations: Allocation[];
  let records: Map<string, ReceivableRecord>;

  if (target.kind === "invoices") {
    const open = await openReceivables(
      deps,
      tx,
      ctx,
      target.allocations.map((a) => a.invoiceId),
    );

    checkAllocations(payment.unapplied, target.allocations, open.balances);
    allocations = target.allocations;
    records = open.records;
  } else {
    const payer = payment.payer;

    if (!target.invoiceIds && (!payer?.ref || payer.type === "insured")) {
      throw invalid("Choose the invoices to apply this payment to");
    }

    const candidates = await deps.receivables.list(tx, ctx, {
      ...(payer && { payerType: payer.type, ...(payer.ref && { payerRef: payer.ref }) }),
      openOnly: true,
    });

    const chosen = target.invoiceIds
      ? candidates.filter((c) => target.invoiceIds!.includes(c.invoiceId))
      : candidates;

    allocations = allocateOldestFirst(
      payment.unapplied,
      chosen.filter((c) => c.kind === "invoice"),
    ).allocations;

    records = new Map(chosen.map((c) => [c.invoiceId, c]));
  }

  const before = payment.toSnapshot();
  const events: CanonicalBillingEvent[] = [];

  for (const allocation of allocations) {
    const receivable = records.get(allocation.invoiceId)!;
    const eventId = `ledger:apply:${newId()}`;

    payment.apply(
      { invoiceId: receivable.invoiceId, policyId: receivable.policyId, amount: allocation.amount },
      eventId,
      clock,
    );

    await post(deps, tx, ctx, {
      key: eventKey(NATIVE_SOURCE, eventId),
      kind: "payment_applied",
      source: { type: "payment", id: payment.id },
      effectiveOn: todayOf(deps, ctx),
      actor: meta.actor,
      memo: `${before.number} applied to ${receivable.number}`,
      lines: applicationLines(payment.toSnapshot(), receivable, allocation.amount),
      billingEventId: eventId,
    });

    events.push({
      id: eventId,
      type: "payment.received",
      occurredAt: now,
      invoiceId: receivable.invoiceId,
      amount: allocation.amount.toJSON(),
      reference: reference(payment),
    });
  }

  await deps.payments.save(tx, ctx, payment);

  await audit(deps, tx, ctx, meta, {
    action: "payment.applied",
    entityType: "payment",
    entityId: payment.id,
    before: { status: before.status, applied: before.applied.toJSON() },
    after: {
      status: payment.toSnapshot().status,
      applied: payment.toSnapshot().applied.toJSON(),
      allocations: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount.toJSON() })),
    },
  });

  return events;
}

export function makeApplyPayment(deps: LedgerDeps & { open: OpenLedger }) {
  return async function applyPayment(
    ctx: TenantContext,
    input: { paymentId: string; target: ApplyTarget } & CommandMeta,
  ): Promise<{ paymentId: string; applied: number }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "payment.apply",
        request: { paymentId: input.paymentId, target: input.target },
        meta: input,
      },
      async (tx) => {
        const payment = await loadPayment(deps, tx, ctx, input.paymentId);
        const events = await applyIn(deps, tx, ctx, payment, input.target, input);

        if (events.length === 0) throw conflict("Nothing open to apply this payment to");

        return { result: { paymentId: payment.id, applied: events.length }, events };
      },
    );
  };
}

/** Takes one application back off its invoice: the cash is unapplied again and PAS reopens it. */
export function makeUnapplyPayment(deps: LedgerDeps & { open: OpenLedger }) {
  return async function unapplyPayment(
    ctx: TenantContext,
    input: { paymentId: string; applicationId: string; reason?: string } & CommandMeta,
  ): Promise<{ paymentId: string }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "payment.unapply",
        request: { paymentId: input.paymentId, applicationId: input.applicationId },
        meta: input,
      },
      async (tx) => {
        const payment = await loadPayment(deps, tx, ctx, input.paymentId);
        const target = payment.activeApplications.find((a) => a.id === input.applicationId);

        if (target?.statementId) {
          throw conflict("Statement remittances come off by reversing the whole payment");
        }

        const application = payment.unapply(input.applicationId, clockOf(deps, ctx));
        const receivable = await deps.receivables.find(tx, ctx, application.invoiceId);

        if (!receivable) throw notFound("Invoice", application.invoiceId);

        const eventId = `ledger:unapply:${application.id}`;

        await post(deps, tx, ctx, {
          key: eventKey(NATIVE_SOURCE, eventId),
          kind: "payment_unapplied",
          source: { type: "payment", id: payment.id },
          effectiveOn: todayOf(deps, ctx),
          actor: input.actor,
          memo: `${payment.toSnapshot().number} unapplied from ${receivable.number}`,
          lines: negate(applicationLines(payment.toSnapshot(), receivable, application.amount)),
          billingEventId: eventId,
        });

        await deps.payments.save(tx, ctx, payment);

        await audit(deps, tx, ctx, input, {
          action: "payment.unapplied",
          entityType: "payment",
          entityId: payment.id,
          before: { applicationId: application.id, amount: application.amount.toJSON() },
          after: { status: payment.toSnapshot().status },
        });

        return {
          result: { paymentId: payment.id },
          events: [
            {
              id: eventId,
              type: "payment.reversed",
              occurredAt: clockOf(deps, ctx).now().toString(),
              invoiceId: receivable.invoiceId,
              amount: application.amount.toJSON(),
              reference: payment.toSnapshot().number,
              reason: input.reason || "Payment unapplied",
            },
          ],
        };
      },
    );
  };
}

export type ApplyPayment = ReturnType<typeof makeApplyPayment>;
export type UnapplyPayment = ReturnType<typeof makeUnapplyPayment>;

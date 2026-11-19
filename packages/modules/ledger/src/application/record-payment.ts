import {
  conflict,
  type Money,
  newId,
  notFound,
  type PlainDate,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { depositsInBatches, type Rail } from "../domain/accounts";
import { Payment } from "../domain/payment";
import { applicationLines, type Payer, receiptLines } from "../domain/posting-rules";
import type { CanonicalBillingEvent } from "../ports/pas-billing";
import type { DepositBatchRecord } from "../ports/repositories";
import { type ApplyTarget, applyIn } from "./apply-payment";
import {
  audit,
  clockOf,
  type CommandMeta,
  eventKey,
  type LedgerDeps,
  NATIVE_SOURCE,
  post,
  runCommand,
} from "./deps";
import type { OpenLedger } from "./open-ledger";

const padded = (prefix: string, value: number) => `${prefix}-${String(value).padStart(6, "0")}`;

export async function nextPaymentNumber(deps: LedgerDeps, tx: Transaction, ctx: TenantContext) {
  return padded("PMT", await deps.payments.nextNumber(tx, ctx, "payment"));
}

/** The open deposit batch for a rail, started when the first check of the day arrives. */
export async function batchFor(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  rail: Rail,
  batchId: string | null,
): Promise<DepositBatchRecord | null> {
  if (!depositsInBatches(rail)) return null;

  if (batchId) {
    const batch = await deps.batches.find(tx, ctx, batchId);

    if (!batch) throw notFound("Deposit batch", batchId);

    if (batch.status !== "open") throw conflict(`${batch.number} was already deposited`);

    return batch;
  }

  const open = await deps.batches.openFor(tx, ctx, rail);

  if (open) return open;

  const now = clockOf(deps, ctx).now();

  const batch: DepositBatchRecord = {
    id: newId(),
    number: padded("DEP", await deps.payments.nextNumber(tx, ctx, "batch")),
    rail,
    status: "open",
    depositedOn: null,
    createdAt: now,
  };

  await deps.batches.save(tx, ctx, batch, now);

  return batch;
}

export interface ReceiveInput {
  rail: Rail;
  payer: Payer | null;
  amount: Money;
  receivedOn: PlainDate;
  reference: string | null;
  memo: string | null;
  batchId?: string | null;
  provider?: string | null;
  providerRef?: string | null;
}

/** Receives a payment into unapplied cash: one receipt entry, in the rail's account. */
export async function receiveIn(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  input: ReceiveInput,
  meta: CommandMeta,
): Promise<Payment> {
  const clock = clockOf(deps, ctx);
  const batch = await batchFor(deps, tx, ctx, input.rail, input.batchId ?? null);

  const payment = Payment.receive(
    {
      tenantId: ctx.tenantId,
      number: await nextPaymentNumber(deps, tx, ctx),
      rail: input.rail,
      payer: input.payer,
      amount: input.amount,
      receivedOn: input.receivedOn,
      reference: input.reference,
      provider: input.provider ?? null,
      providerRef: input.providerRef ?? null,
      batchId: batch?.id ?? null,
      memo: input.memo,
    },
    clock,
  );

  await deps.payments.save(tx, ctx, payment);

  const p = payment.toSnapshot();

  await post(deps, tx, ctx, {
    key: `payment:${payment.id}`,
    kind: "payment_received",
    source: { type: "payment", id: payment.id },
    effectiveOn: input.receivedOn,
    actor: meta.actor,
    memo: `${p.number} received by ${input.rail.replace("_", " ")}${input.reference ? ` (${input.reference})` : ""}${input.payer?.name ? ` from ${input.payer.name}` : ""}`,
    lines: receiptLines(p, input.amount),
  });

  await audit(deps, tx, ctx, meta, {
    action: "payment.received",
    entityType: "payment",
    entityId: payment.id,
    after: {
      number: p.number,
      rail: p.rail,
      amount: p.amount.toJSON(),
      receivedOn: p.receivedOn.toString(),
      reference: p.reference,
      payer: p.payer,
      batchId: p.batchId,
    },
  });

  return payment;
}

/**
 * Finance staff record a check, wire or ACH push (PLAN §13 offline payments), optionally applying
 * it in the same step.
 */
export function makeRecordPayment(deps: LedgerDeps & { open: OpenLedger }) {
  return async function recordPayment(
    ctx: TenantContext,
    input: ReceiveInput & { apply?: ApplyTarget } & CommandMeta,
  ): Promise<{ paymentId: string; number: string }> {
    await deps.open(ctx);

    const { actor, idempotencyKey, ...request } = input;

    return runCommand(
      deps,
      ctx,
      { action: "payment.record", request, meta: { actor, idempotencyKey } },
      async (tx) => {
        const payment = await receiveIn(deps, tx, ctx, input, input);

        const events: CanonicalBillingEvent[] = input.apply
          ? await applyIn(deps, tx, ctx, payment, input.apply, input)
          : [];

        return {
          result: { paymentId: payment.id, number: payment.toSnapshot().number },
          events,
        };
      },
    );
  };
}

export interface CardPaymentInput {
  invoiceId: string;
  amount: Money;
  provider: string;
  providerRef: string;
  method: { brand?: string; last4?: string };
  actor: CommandMeta["actor"];
}

/**
 * A card charge captured by the payment provider, posted through the ledger: receipt into card
 * clearing and application to the invoice in one entry, then `payment.received` to PAS under the
 * same event id the charge path has always used, so a retried charge never posts twice.
 */
export function makeRecordCardPayment(deps: LedgerDeps & { open: OpenLedger }) {
  return async function recordCardPayment(
    ctx: TenantContext,
    input: CardPaymentInput,
  ): Promise<{ eventId: string }> {
    await deps.open(ctx);

    const eventId = `${input.provider}:${input.providerRef}`;
    const key = eventKey(NATIVE_SOURCE, eventId);
    const clock = clockOf(deps, ctx);

    const event: CanonicalBillingEvent = {
      id: eventId,
      type: "payment.received",
      occurredAt: clock.now().toString(),
      invoiceId: input.invoiceId,
      amount: input.amount.toJSON(),
      reference: input.providerRef,
      method: input.method,
    };

    return runCommand(
      deps,
      ctx,
      { action: "payment.card", request: { eventId }, meta: { actor: input.actor } },
      async (tx) => {
        if (await deps.journal.findByKey(tx, ctx, key))
          return { result: { eventId }, events: [event] };

        const receivable = await deps.receivables.find(tx, ctx, input.invoiceId);

        if (!receivable) throw notFound("Invoice", input.invoiceId);

        const payment = Payment.receive(
          {
            tenantId: ctx.tenantId,
            number: await nextPaymentNumber(deps, tx, ctx),
            rail: "card",
            payer: {
              type: receivable.payerType,
              ref: receivable.payerRef,
              name: receivable.payerName,
            },
            amount: input.amount,
            receivedOn: clock.today("UTC"),
            reference: input.method.last4
              ? `${input.method.brand ?? "Card"} ending ${input.method.last4}`
              : input.providerRef,
            provider: input.provider,
            providerRef: input.providerRef,
            batchId: null,
            memo: null,
          },
          clock,
        );

        payment.apply(
          { invoiceId: receivable.invoiceId, policyId: receivable.policyId, amount: input.amount },
          eventId,
          clock,
        );

        await deps.payments.save(tx, ctx, payment);

        const p = payment.toSnapshot();

        await post(deps, tx, ctx, {
          key,
          kind: "payment_received",
          source: { type: "payment", id: payment.id },
          effectiveOn: p.receivedOn,
          actor: input.actor,
          memo: `${p.number} by ${p.reference} for ${receivable.number}`,
          lines: [
            ...receiptLines(p, input.amount),
            ...applicationLines(p, receivable, input.amount),
          ],
          billingEventId: eventId,
        });

        await audit(
          deps,
          tx,
          ctx,
          { actor: input.actor },
          {
            action: "payment.card_received",
            entityType: "payment",
            entityId: payment.id,
            after: { number: p.number, amount: p.amount.toJSON(), invoiceId: receivable.invoiceId },
          },
        );

        return { result: { eventId }, events: [event] };
      },
    );
  };
}

export type RecordPayment = ReturnType<typeof makeRecordPayment>;
export type RecordCardPayment = ReturnType<typeof makeRecordCardPayment>;

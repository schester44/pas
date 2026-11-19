import { conflict, type Money, newId, notFound, type TenantContext } from "@pas/kernel";
import {
  creditRefundLines,
  type RefundMethod,
  refundCheckLines,
  unappliedRefundLines,
} from "../domain/posting-rules";
import type { CanonicalBillingEvent } from "../ports/pas-billing";
import type { RefundRecord } from "../ports/repositories";
import { loadPayment } from "./apply-payment";
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

export type RefundSource =
  | { kind: "credit_balance"; invoiceId: string }
  | { kind: "unapplied"; paymentId: string };

interface ProviderTarget {
  paymentRef: string;
}

/**
 * Pays money back: a credit balance on a credit note (a cancellation's return premium) or
 * unapplied cash. By the payment provider to the card that paid, or as a check request that
 * finance issues later. A credit-balance refund goes to PAS as `refund.issued`.
 */
export function makeRefund(deps: LedgerDeps & { open: OpenLedger }) {
  async function providerTarget(ctx: TenantContext, source: RefundSource): Promise<ProviderTarget> {
    const payments = await deps.queries.payments(ctx, {
      ...(source.kind === "unapplied" ? {} : { policyId: await policyOf(ctx, source.invoiceId) }),
      limit: 100,
    });

    const card = payments.find(
      (p) =>
        p.rail === "card" &&
        p.status !== "reversed" &&
        (source.kind === "credit_balance" || p.id === source.paymentId),
    );

    const ref = card && (await deps.uow.run(ctx, (tx) => deps.payments.find(tx, ctx, card.id)));
    const providerRef = ref?.toSnapshot().providerRef;

    if (!providerRef)
      throw conflict("There's no card payment to refund to; refund by check instead");

    return { paymentRef: providerRef };
  }

  async function policyOf(ctx: TenantContext, invoiceId: string): Promise<string> {
    const receivable = await deps.uow.run(ctx, (tx) => deps.receivables.find(tx, ctx, invoiceId));

    if (!receivable) throw notFound("Invoice", invoiceId);

    return receivable.policyId;
  }

  return async function refund(
    ctx: TenantContext,
    input: { source: RefundSource; amount: Money; method: RefundMethod } & CommandMeta,
  ): Promise<{ refundId: string; number: string }> {
    await deps.open(ctx);

    const request = { source: input.source, amount: input.amount.toJSON(), method: input.method };
    const refundId = newId();

    const provider =
      input.method === "provider"
        ? await deps.cards.refund(ctx, {
            ...(await providerTarget(ctx, input.source)),
            amount: input.amount,
            idempotencyKey: `ledger-refund:${input.idempotencyKey ?? refundId}`,
          })
        : null;

    return runCommand(deps, ctx, { action: "refund.issue", request, meta: input }, async (tx) => {
      const clock = clockOf(deps, ctx);
      const now = clock.now();
      const number = `RF-${String(await deps.payments.nextNumber(tx, ctx, "refund")).padStart(6, "0")}`;
      const events: CanonicalBillingEvent[] = [];
      let record: RefundRecord;

      if (input.source.kind === "credit_balance") {
        const receivable = await deps.receivables.find(tx, ctx, input.source.invoiceId);

        if (!receivable) throw notFound("Invoice", input.source.invoiceId);

        const balance = (
          await deps.receivables.balances(tx, ctx, { invoiceIds: [receivable.invoiceId] })
        ).get(receivable.invoiceId);

        if (receivable.kind !== "credit_note" || !balance?.isNegative()) {
          throw conflict(`${receivable.number} has no credit balance to refund`);
        }

        if (input.amount.amount.greaterThan(balance.negated().amount)) {
          throw conflict(`${receivable.number} has only ${balance.negated().toString()} of credit`);
        }

        const eventId = `ledger:refund:${refundId}`;

        await post(deps, tx, ctx, {
          key: eventKey(NATIVE_SOURCE, eventId),
          kind: "refund_issued",
          source: { type: "refund", id: refundId },
          effectiveOn: todayOf(deps, ctx),
          actor: input.actor,
          memo: `${number}: ${receivable.number} credit refunded ${input.method === "provider" ? "to card" : "by check request"}`,
          lines: creditRefundLines(receivable, input.amount, input.method),
          billingEventId: eventId,
        });

        events.push({
          id: eventId,
          type: "refund.issued",
          occurredAt: now.toString(),
          invoiceId: receivable.invoiceId,
          amount: input.amount.toJSON(),
          reference: provider?.refundId ?? number,
        });

        record = {
          id: refundId,
          number,
          source: "credit_balance",
          paymentId: null,
          invoiceId: receivable.invoiceId,
          payerName: receivable.payerName,
          amount: input.amount,
          method: input.method,
          status: provider ? "issued" : "requested",
          checkNumber: null,
          providerRef: provider?.refundId ?? null,
          createdAt: now,
        };
      } else {
        const payment = await loadPayment(deps, tx, ctx, input.source.paymentId);

        payment.refund(input.amount, clock);
        await deps.payments.save(tx, ctx, payment);

        const p = payment.toSnapshot();

        await post(deps, tx, ctx, {
          key: `refund:${refundId}`,
          kind: "refund_issued",
          source: { type: "refund", id: refundId },
          effectiveOn: todayOf(deps, ctx),
          actor: input.actor,
          memo: `${number}: unapplied cash on ${p.number} refunded ${input.method === "provider" ? "to card" : "by check request"}`,
          lines: unappliedRefundLines(p, input.amount, input.method),
        });

        record = {
          id: refundId,
          number,
          source: "unapplied",
          paymentId: payment.id,
          invoiceId: null,
          payerName: p.payer?.name ?? null,
          amount: input.amount,
          method: input.method,
          status: provider ? "issued" : "requested",
          checkNumber: null,
          providerRef: provider?.refundId ?? null,
          createdAt: now,
        };
      }

      await deps.refunds.save(tx, ctx, record, now);

      await audit(deps, tx, ctx, input, {
        action: "refund.issued",
        entityType: "refund",
        entityId: refundId,
        after: { ...record, amount: record.amount.toJSON(), createdAt: now.toString() },
      });

      return { result: { refundId, number }, events };
    });
  };
}

/** Finance cut the check for a requested refund: refunds payable out of the operating account. */
export function makeIssueRefundCheck(deps: LedgerDeps & { open: OpenLedger }) {
  return async function issueRefundCheck(
    ctx: TenantContext,
    input: { refundId: string; checkNumber: string } & CommandMeta,
  ): Promise<{ refundId: string }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "refund.check",
        request: { refundId: input.refundId, checkNumber: input.checkNumber },
        meta: input,
      },
      async (tx) => {
        const refund = await deps.refunds.find(tx, ctx, input.refundId);

        if (!refund) throw notFound("Refund", input.refundId);

        if (refund.method !== "check" || refund.status !== "requested") {
          throw conflict(`${refund.number} isn't waiting for a check`);
        }

        await post(deps, tx, ctx, {
          key: `refund-check:${refund.id}`,
          kind: "refund_check_issued",
          source: { type: "refund", id: refund.id },
          effectiveOn: todayOf(deps, ctx),
          actor: input.actor,
          memo: `${refund.number} paid by check ${input.checkNumber}`,
          lines: refundCheckLines(refund.amount, {
            invoiceId: refund.invoiceId,
            paymentId: refund.paymentId,
          }),
        });

        const now = clockOf(deps, ctx).now();
        const updated = { ...refund, status: "issued" as const, checkNumber: input.checkNumber };

        await deps.refunds.save(tx, ctx, updated, now);

        await audit(deps, tx, ctx, input, {
          action: "refund.check_issued",
          entityType: "refund",
          entityId: refund.id,
          before: { status: refund.status },
          after: { status: updated.status, checkNumber: input.checkNumber },
        });

        return { result: { refundId: refund.id } };
      },
    );
  };
}

export type Refund = ReturnType<typeof makeRefund>;
export type IssueRefundCheck = ReturnType<typeof makeIssueRefundCheck>;

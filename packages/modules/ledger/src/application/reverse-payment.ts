import { accountFor, railAccount } from "../domain/accounts";
import { credit, debit } from "../domain/journal";
import { applicationLines, negate } from "../domain/posting-rules";
import { type Money, notFound, type TenantContext } from "@pas/kernel";
import type { CanonicalBillingEvent } from "../ports/pas-billing";
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

export const REVERSAL_REASONS = {
  nsf: "Returned for insufficient funds",
  chargeback: "Chargeback",
  stop_payment: "Stop payment",
  error: "Recorded in error",
} as const;

export type ReversalReason = keyof typeof REVERSAL_REASONS;

/**
 * A payment returned unpaid (NSF, chargeback, stop payment): each application comes off its
 * invoice, then the receipt is reversed out of the account the money went into. PAS gets a
 * `payment.reversed` per invoice (or per statement), which reopens the bills and drives
 * nonpayment exactly as an external billing system's reversal would.
 */
export function makeReversePayment(deps: LedgerDeps & { open: OpenLedger }) {
  return async function reversePayment(
    ctx: TenantContext,
    input: { paymentId: string; reason: ReversalReason; note?: string } & CommandMeta,
  ): Promise<{ paymentId: string }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "payment.reverse",
        request: { paymentId: input.paymentId, reason: input.reason, note: input.note ?? null },
        meta: input,
      },
      async (tx) => {
        const payment = await loadPayment(deps, tx, ctx, input.paymentId);
        const before = payment.toSnapshot();
        const reason = `${REVERSAL_REASONS[input.reason]}${input.note ? `: ${input.note}` : ""}`;
        const clock = clockOf(deps, ctx);
        const now = clock.now().toString();
        const effectiveOn = todayOf(deps, ctx);
        const applications = payment.reverse(reason, clock);
        const p = payment.toSnapshot();
        const events: CanonicalBillingEvent[] = [];
        const byStatement = new Map<string, Money>();

        for (const application of applications) {
          const receivable = await deps.receivables.find(tx, ctx, application.invoiceId);

          if (!receivable) throw notFound("Invoice", application.invoiceId);

          const direct = !application.statementId;
          const eventId = `ledger:reverse:${application.id}`;

          await post(deps, tx, ctx, {
            key: direct
              ? eventKey(NATIVE_SOURCE, eventId)
              : `reverse-application:${application.id}`,
            kind: "payment_unapplied",
            source: { type: "payment", id: payment.id },
            effectiveOn,
            actor: input.actor,
            memo: `${p.number} returned: taken off ${receivable.number}`,
            lines: negate(applicationLines(p, receivable, application.amount)),
            ...(direct && { billingEventId: eventId }),
          });

          if (direct) {
            events.push({
              id: eventId,
              type: "payment.reversed",
              occurredAt: now,
              invoiceId: receivable.invoiceId,
              amount: application.amount.toJSON(),
              reference: p.number,
              reason,
            });

            continue;
          }

          const sid = application.statementId!;

          byStatement.set(
            sid,
            (byStatement.get(sid) ?? application.amount.minus(application.amount)).plus(
              application.amount,
            ),
          );
        }

        for (const [statementId, amount] of byStatement) {
          events.push({
            id: `ledger:reverse-stmt:${payment.id}:${statementId}`,
            type: "payment.reversed",
            occurredAt: now,
            statementId,
            amount: amount.toJSON(),
            reference: p.number,
            reason,
          });
        }

        const batch = p.batchId ? await deps.batches.find(tx, ctx, p.batchId) : null;

        const from =
          batch?.status === "deposited" ? accountFor("cash_operating") : railAccount(p.rail);

        await post(deps, tx, ctx, {
          key: `payment-reversal:${payment.id}`,
          kind: "payment_reversed",
          source: { type: "payment", id: payment.id },
          effectiveOn,
          actor: input.actor,
          memo: `${p.number} reversed: ${reason}`,
          lines: [
            debit(accountFor("unapplied_cash"), p.amount, {
              payerType: p.payer?.type ?? null,
              payerRef: p.payer?.ref ?? null,
              paymentId: payment.id,
            }),
            credit(from, p.amount, { paymentId: payment.id }),
          ],
        });

        await deps.payments.save(tx, ctx, payment);

        await audit(deps, tx, ctx, input, {
          action: "payment.reversed",
          entityType: "payment",
          entityId: payment.id,
          before: { status: before.status, applied: before.applied.toJSON() },
          after: { status: p.status, reason },
        });

        return { result: { paymentId: payment.id }, events };
      },
    );
  };
}

export type ReversePayment = ReturnType<typeof makeReversePayment>;

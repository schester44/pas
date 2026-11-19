import { conflict, type Money, newId, notFound, type TenantContext } from "@pas/kernel";
import { creditTransferLines } from "../domain/posting-rules";
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

/** Draws a credit note's credit to pay another open invoice; PAS gets `credit.applied`. */
export function makeApplyCredit(deps: LedgerDeps & { open: OpenLedger }) {
  return async function applyCredit(
    ctx: TenantContext,
    input: { creditNoteId: string; invoiceId: string; amount: Money } & CommandMeta,
  ): Promise<{ applied: true }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "credit.apply",
        request: {
          creditNoteId: input.creditNoteId,
          invoiceId: input.invoiceId,
          amount: input.amount.toJSON(),
        },
        meta: input,
      },
      async (tx) => {
        const [from, to] = await Promise.all([
          deps.receivables.find(tx, ctx, input.creditNoteId),
          deps.receivables.find(tx, ctx, input.invoiceId),
        ]);

        if (!from) throw notFound("Credit note", input.creditNoteId);

        if (!to) throw notFound("Invoice", input.invoiceId);

        const balances = await deps.receivables.balances(tx, ctx, {
          invoiceIds: [from.invoiceId, to.invoiceId],
        });

        const credit = balances.get(from.invoiceId)?.negated();
        const owed = balances.get(to.invoiceId);

        if (
          from.kind !== "credit_note" ||
          !credit?.amount.greaterThanOrEqualTo(input.amount.amount)
        ) {
          throw conflict(`${from.number} doesn't have ${input.amount.toString()} of credit`);
        }

        if (to.kind !== "invoice" || !owed?.amount.greaterThanOrEqualTo(input.amount.amount)) {
          throw conflict(`${to.number} doesn't have ${input.amount.toString()} open`);
        }

        const eventId = `ledger:credit:${newId()}`;

        await post(deps, tx, ctx, {
          key: eventKey(NATIVE_SOURCE, eventId),
          kind: "credit_applied",
          source: { type: "invoice", id: from.invoiceId },
          effectiveOn: todayOf(deps, ctx),
          actor: input.actor,
          memo: `Credit from ${from.number} applied to ${to.number}`,
          lines: creditTransferLines(from, to, input.amount),
          billingEventId: eventId,
        });

        await audit(deps, tx, ctx, input, {
          action: "credit.applied",
          entityType: "invoice",
          entityId: to.invoiceId,
          after: { creditNoteId: from.invoiceId, amount: input.amount.toJSON() },
        });

        return {
          result: { applied: true as const },
          events: [
            {
              id: eventId,
              type: "credit.applied",
              occurredAt: clockOf(deps, ctx).now().toString(),
              invoiceId: to.invoiceId,
              creditNoteId: from.invoiceId,
              amount: input.amount.toJSON(),
            },
          ],
        };
      },
    );
  };
}

export type ApplyCredit = ReturnType<typeof makeApplyCredit>;

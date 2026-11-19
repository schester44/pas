import {
  conflict,
  type Money,
  newId,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { writeOffLines } from "../domain/posting-rules";
import { assertApprover, writeOffNeedsApproval } from "../domain/write-off";
import type { CanonicalBillingEvent } from "../ports/pas-billing";
import type { WriteOffRecord } from "../ports/repositories";
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

const actorId = (meta: CommandMeta) => meta.actor.id ?? meta.actor.name;

async function postWriteOff(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  writeOff: WriteOffRecord,
  meta: CommandMeta,
): Promise<CanonicalBillingEvent> {
  const receivable = await deps.receivables.find(tx, ctx, writeOff.invoiceId);

  if (!receivable) throw notFound("Invoice", writeOff.invoiceId);

  const balance = (
    await deps.receivables.balances(tx, ctx, { invoiceIds: [receivable.invoiceId] })
  ).get(receivable.invoiceId);

  if (!balance || writeOff.amount.amount.greaterThan(balance.amount)) {
    throw conflict(`${receivable.number} has only ${balance?.toString() ?? "0"} open`);
  }

  const eventId = `ledger:writeoff:${writeOff.id}`;

  await post(deps, tx, ctx, {
    key: eventKey(NATIVE_SOURCE, eventId),
    kind: "write_off",
    source: { type: "write_off", id: writeOff.id },
    effectiveOn: todayOf(deps, ctx),
    actor: meta.actor,
    memo: `${receivable.number} written off: ${writeOff.reason}`,
    lines: writeOffLines(receivable, writeOff.amount),
    billingEventId: eventId,
  });

  return {
    id: eventId,
    type: "writeoff.applied",
    occurredAt: clockOf(deps, ctx).now().toString(),
    invoiceId: receivable.invoiceId,
    amount: writeOff.amount.toJSON(),
    reason: writeOff.reason,
  };
}

/**
 * Writes off what's left on an invoice. At or under the tenant's small-balance threshold it posts
 * at once; above it, it waits for someone else to approve.
 */
export function makeRequestWriteOff(deps: LedgerDeps & { open: OpenLedger }) {
  return async function requestWriteOff(
    ctx: TenantContext,
    input: { invoiceId: string; amount: Money; reason: string } & CommandMeta,
  ): Promise<{ writeOffId: string; status: WriteOffRecord["status"] }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "writeoff.request",
        request: {
          invoiceId: input.invoiceId,
          amount: input.amount.toJSON(),
          reason: input.reason,
        },
        meta: input,
      },
      async (tx) => {
        const settings = await deps.settings.find(tx, ctx);
        const now = clockOf(deps, ctx).now();

        const automatic = !writeOffNeedsApproval(
          input.amount,
          settings?.smallBalanceWriteOff ?? null,
        );

        const writeOff: WriteOffRecord = {
          id: newId(),
          invoiceId: input.invoiceId,
          amount: input.amount,
          reason: input.reason,
          status: automatic ? "posted" : "pending_approval",
          requestedBy: { id: actorId(input), name: input.actor.name },
          decidedBy: automatic ? { id: "small_balance", name: "Small-balance rule" } : null,
          createdAt: now,
        };

        const events = automatic ? [await postWriteOff(deps, tx, ctx, writeOff, input)] : [];

        await deps.writeOffs.save(tx, ctx, writeOff, now);

        await audit(deps, tx, ctx, input, {
          action: automatic ? "writeoff.posted" : "writeoff.requested",
          entityType: "write_off",
          entityId: writeOff.id,
          after: {
            invoiceId: writeOff.invoiceId,
            amount: writeOff.amount.toJSON(),
            status: writeOff.status,
          },
        });

        return { result: { writeOffId: writeOff.id, status: writeOff.status }, events };
      },
    );
  };
}

export function makeDecideWriteOff(deps: LedgerDeps & { open: OpenLedger }) {
  return async function decideWriteOff(
    ctx: TenantContext,
    input: { writeOffId: string; approve: boolean } & CommandMeta,
  ): Promise<{ writeOffId: string; status: WriteOffRecord["status"] }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "writeoff.decide",
        request: { writeOffId: input.writeOffId, approve: input.approve },
        meta: input,
      },
      async (tx) => {
        const writeOff = await deps.writeOffs.find(tx, ctx, input.writeOffId);

        if (!writeOff) throw notFound("Write-off", input.writeOffId);

        if (writeOff.status !== "pending_approval")
          throw conflict("This write-off was already decided");

        assertApprover(writeOff.requestedBy.id, actorId(input));

        const decided: WriteOffRecord = {
          ...writeOff,
          status: input.approve ? "posted" : "rejected",
          decidedBy: { id: actorId(input), name: input.actor.name },
        };

        const events = input.approve ? [await postWriteOff(deps, tx, ctx, decided, input)] : [];

        await deps.writeOffs.save(tx, ctx, decided, clockOf(deps, ctx).now());

        await audit(deps, tx, ctx, input, {
          action: input.approve ? "writeoff.approved" : "writeoff.rejected",
          entityType: "write_off",
          entityId: writeOff.id,
          before: { status: writeOff.status },
          after: { status: decided.status },
        });

        return { result: { writeOffId: writeOff.id, status: decided.status }, events };
      },
    );
  };
}

/** Undoes a posted write-off with a reversing entry; PAS gets `writeoff.removed`. */
export function makeReverseWriteOff(deps: LedgerDeps & { open: OpenLedger }) {
  return async function reverseWriteOff(
    ctx: TenantContext,
    input: { writeOffId: string; reason: string } & CommandMeta,
  ): Promise<{ writeOffId: string }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "writeoff.reverse",
        request: { writeOffId: input.writeOffId, reason: input.reason },
        meta: input,
      },
      async (tx) => {
        const writeOff = await deps.writeOffs.find(tx, ctx, input.writeOffId);

        if (!writeOff || writeOff.status !== "posted")
          throw conflict("Only a posted write-off can be reversed");

        const original = await deps.journal.findByKey(
          tx,
          ctx,
          eventKey(NATIVE_SOURCE, `ledger:writeoff:${writeOff.id}`),
        );

        if (!original || (await deps.journal.isReversed(tx, ctx, original.id))) {
          throw conflict("This write-off was already reversed");
        }

        const eventId = `ledger:writeoff-reversal:${writeOff.id}`;
        const clock = clockOf(deps, ctx);

        await deps.journal.post(
          tx,
          ctx,
          original.reverse(
            {
              key: eventKey(NATIVE_SOURCE, eventId),
              effectiveOn: todayOf(deps, ctx),
              actor: input.actor,
              memo: `Write-off reversed: ${input.reason}`,
              billingEventId: eventId,
            },
            clock,
          ),
        );

        await audit(deps, tx, ctx, input, {
          action: "writeoff.reversed",
          entityType: "write_off",
          entityId: writeOff.id,
          before: { entryId: original.id },
          after: { reason: input.reason },
        });

        return {
          result: { writeOffId: writeOff.id },
          events: [
            {
              id: eventId,
              type: "writeoff.removed",
              occurredAt: clock.now().toString(),
              invoiceId: writeOff.invoiceId,
              amount: writeOff.amount.toJSON(),
              reason: input.reason,
            },
          ],
        };
      },
    );
  };
}

export type RequestWriteOff = ReturnType<typeof makeRequestWriteOff>;
export type DecideWriteOff = ReturnType<typeof makeDecideWriteOff>;
export type ReverseWriteOff = ReturnType<typeof makeReverseWriteOff>;

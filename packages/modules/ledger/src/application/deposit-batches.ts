import { conflict, notFound, type PlainDate, type TenantContext } from "@pas/kernel";
import { depositsInBatches, type Rail } from "../domain/accounts";
import { depositLines } from "../domain/posting-rules";
import { audit, clockOf, type CommandMeta, type LedgerDeps, post, runCommand } from "./deps";
import type { OpenLedger } from "./open-ledger";
import { batchFor } from "./record-payment";

/** Checks collected for the bank: a batch per rail, deposited in one move to the operating account. */
export function makeDepositBatches(deps: LedgerDeps & { open: OpenLedger }) {
  return {
    async open(
      ctx: TenantContext,
      input: { rail: Rail } & CommandMeta,
    ): Promise<{ batchId: string }> {
      await deps.open(ctx);

      if (!depositsInBatches(input.rail))
        throw conflict("Only checks and lockbox items are deposited in batches");

      return runCommand(
        deps,
        ctx,
        { action: "batch.open", request: { rail: input.rail }, meta: input },
        async (tx) => {
          const batch = await batchFor(deps, tx, ctx, input.rail, null);

          return { result: { batchId: batch!.id } };
        },
      );
    },

    async deposit(
      ctx: TenantContext,
      input: { batchId: string; depositedOn: PlainDate } & CommandMeta,
    ): Promise<{ batchId: string }> {
      await deps.open(ctx);

      return runCommand(
        deps,
        ctx,
        {
          action: "batch.deposit",
          request: { batchId: input.batchId, depositedOn: input.depositedOn.toString() },
          meta: input,
        },
        async (tx) => {
          const batch = await deps.batches.find(tx, ctx, input.batchId);

          if (!batch) throw notFound("Deposit batch", input.batchId);

          if (batch.status !== "open") throw conflict(`${batch.number} was already deposited`);

          const total = await deps.batches.total(tx, ctx, batch.id);

          if (!total?.amount.greaterThan(0))
            throw conflict(`${batch.number} has nothing to deposit`);

          await post(deps, tx, ctx, {
            key: `deposit:${batch.id}`,
            kind: "deposit",
            source: { type: "deposit_batch", id: batch.id },
            effectiveOn: input.depositedOn,
            actor: input.actor,
            memo: `${batch.number} deposited`,
            lines: depositLines(total),
          });

          const now = clockOf(deps, ctx).now();

          await deps.batches.save(
            tx,
            ctx,
            { ...batch, status: "deposited", depositedOn: input.depositedOn },
            now,
          );

          await audit(deps, tx, ctx, input, {
            action: "batch.deposited",
            entityType: "deposit_batch",
            entityId: batch.id,
            before: { status: batch.status },
            after: {
              status: "deposited",
              total: total.toJSON(),
              depositedOn: input.depositedOn.toString(),
            },
          });

          return { result: { batchId: batch.id } };
        },
      );
    },
  };
}

export type DepositBatches = ReturnType<typeof makeDepositBatches>;

import { conflict, Money, newId, notFound, type TenantContext } from "@pas/kernel";
import { matchLockboxRow, parseLockbox } from "../domain/lockbox";
import type { CanonicalBillingEvent } from "../ports/pas-billing";
import type { LockboxItemRecord } from "../ports/repositories";
import { applyIn, loadPayment } from "./apply-payment";
import { audit, clockOf, type CommandMeta, type LedgerDeps, runCommand, todayOf } from "./deps";
import type { OpenLedger } from "./open-ledger";
import { receiveIn } from "./record-payment";

/**
 * A bank lockbox file (CSV). Each row is received into its own deposit batch; rows that match an
 * invoice, statement, loan or policy number are applied, the rest wait in unapplied cash as
 * exceptions until someone matches them.
 */
export function makeLockbox(deps: LedgerDeps & { open: OpenLedger }) {
  return {
    async import(
      ctx: TenantContext,
      input: { fileName: string; csv: string; currency: string } & CommandMeta,
    ): Promise<{ importId: string; rows: number; matched: number; exceptions: number }> {
      await deps.open(ctx);

      const rows = (() => {
        try {
          return parseLockbox(input.csv, input.currency, todayOf(deps, ctx));
        } catch (error) {
          throw conflict((error as Error).message);
        }
      })();

      if (rows.length === 0) throw conflict("The file has no rows");

      return runCommand(
        deps,
        ctx,
        {
          action: "lockbox.import",
          request: { fileName: input.fileName, csv: input.csv },
          meta: input,
        },
        async (tx) => {
          const clock = clockOf(deps, ctx);
          const now = clock.now();
          const importId = newId();

          const batch = {
            id: newId(),
            number: `DEP-${String(await deps.payments.nextNumber(tx, ctx, "batch")).padStart(6, "0")}`,
            rail: "lockbox" as const,
            status: "open" as const,
            depositedOn: null,
            createdAt: now,
          };

          await deps.batches.save(tx, ctx, batch, now);

          const candidates = (await deps.receivables.list(tx, ctx, { openOnly: true })).filter(
            (c) => c.kind === "invoice",
          );

          const events: CanonicalBillingEvent[] = [];
          let matched = 0;

          for (const row of rows) {
            const match = matchLockboxRow(row, candidates);
            let paymentId: string | null = null;

            if (row.amount && row.receivedOn) {
              const payment = await receiveIn(
                deps,
                tx,
                ctx,
                {
                  rail: "lockbox",
                  payer: match.by ? match.payer : null,
                  amount: row.amount,
                  receivedOn: row.receivedOn,
                  reference: row.checkNumber
                    ? `Check ${row.checkNumber}`
                    : `Lockbox row ${row.row}`,
                  memo: `${input.fileName}, row ${row.row}${row.payerName ? `, ${row.payerName}` : ""}`,
                  batchId: batch.id,
                },
                input,
              );

              paymentId = payment.id;

              if (match.by) {
                events.push(
                  ...(await applyIn(
                    deps,
                    tx,
                    ctx,
                    payment,
                    match.by === "statement" && match.statementId
                      ? { kind: "statement", statementId: match.statementId, amount: row.amount }
                      : { kind: "oldest_first", invoiceIds: match.items.map((i) => i.invoiceId) },
                    input,
                  )),
                );

                matched++;
              }
            }

            const item: LockboxItemRecord = {
              id: newId(),
              importId,
              row: row.row,
              raw: row.raw,
              amount: row.amount ?? Money.zero(input.currency),
              reference: row.checkNumber,
              matchedBy: match.by,
              status: match.by ? "matched" : "exception",
              reason: match.by ? null : match.reason,
              paymentId,
              invoiceId: match.by ? (match.items[0]?.invoiceId ?? null) : null,
            };

            await deps.lockbox.saveItem(tx, ctx, item, now);
          }

          const result = {
            importId,
            rows: rows.length,
            matched,
            exceptions: rows.length - matched,
          };

          await deps.lockbox.saveImport(tx, ctx, {
            id: importId,
            fileName: input.fileName,
            batchId: batch.id,
            rows: result.rows,
            matched,
            exceptions: result.exceptions,
            importedAt: now,
          });

          await audit(deps, tx, ctx, input, {
            action: "lockbox.imported",
            entityType: "lockbox_import",
            entityId: importId,
            after: { fileName: input.fileName, ...result, batchId: batch.id },
          });

          return { result, events };
        },
      );
    },

    /** Staff identified an exception: its cash goes to the invoice they picked. */
    async resolve(
      ctx: TenantContext,
      input: { itemId: string; invoiceId: string } & CommandMeta,
    ): Promise<{ itemId: string }> {
      await deps.open(ctx);

      return runCommand(
        deps,
        ctx,
        {
          action: "lockbox.resolve",
          request: { itemId: input.itemId, invoiceId: input.invoiceId },
          meta: input,
        },
        async (tx) => {
          const item = await deps.lockbox.findItem(tx, ctx, input.itemId);

          if (!item) throw notFound("Lockbox item", input.itemId);

          if (item.status !== "exception" || !item.paymentId)
            throw conflict("This item isn't an open exception");

          const receivable = await deps.receivables.find(tx, ctx, input.invoiceId);

          if (!receivable) throw notFound("Invoice", input.invoiceId);

          const clock = clockOf(deps, ctx);
          const payment = await loadPayment(deps, tx, ctx, item.paymentId);

          payment.identify(
            { type: receivable.payerType, ref: receivable.payerRef, name: receivable.payerName },
            clock,
          );

          const events = await applyIn(
            deps,
            tx,
            ctx,
            payment,
            { kind: "oldest_first", invoiceIds: [receivable.invoiceId] },
            input,
          );

          if (events.length === 0) throw conflict(`${receivable.number} has nothing open`);

          await deps.lockbox.saveItem(
            tx,
            ctx,
            { ...item, status: "resolved", invoiceId: receivable.invoiceId, matchedBy: "staff" },
            clock.now(),
          );

          await audit(deps, tx, ctx, input, {
            action: "lockbox.resolved",
            entityType: "lockbox_item",
            entityId: item.id,
            before: { status: item.status, reason: item.reason },
            after: { status: "resolved", invoiceId: receivable.invoiceId },
          });

          return { result: { itemId: item.id }, events };
        },
      );
    },
  };
}

export type Lockbox = ReturnType<typeof makeLockbox>;

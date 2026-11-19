import { invalid, Money, newId, type TenantContext, workflowRef } from "@pas/kernel";
import { cacheDrift, reconcileReceivables } from "../domain/reconciliation";
import type { ReconciliationRecord } from "../ports/repositories";
import { clockOf, type LedgerDeps, SYSTEM } from "./deps";
import type { CatchUp } from "./catch-up";
import { alignToWrittenBasis, type OpenLedger, writtenBalance } from "./open-ledger";

/**
 * Ledger receivables against PAS's open invoice balances, and each cached account balance against
 * the sum of its lines. Differences are kept with the run for finance to work through.
 */
export function makeReconcile(deps: LedgerDeps & { open: OpenLedger; catchUp: CatchUp }) {
  return async function reconcile(ctx: TenantContext): Promise<ReconciliationRecord> {
    await deps.open(ctx);
    await deps.catchUp(ctx);
    await alignToWrittenBasis(deps, ctx);

    const pas = await deps.pas.invoices(ctx);
    const clock = clockOf(deps, ctx);

    return deps.uow.run(ctx, async (tx) => {
      const settings = await deps.settings.find(tx, ctx);
      const currency = settings?.currency ?? pas[0]?.currency ?? "USD";
      const balances = await deps.receivables.balances(tx, ctx);
      const records = await deps.receivables.list(tx, ctx, {});
      const numbers = new Map(records.map((r) => [r.invoiceId, r.number]));

      const ledger = new Map(
        [...new Set([...balances.keys(), ...numbers.keys()])].map((id) => [
          id,
          { number: numbers.get(id) ?? id, balance: balances.get(id) ?? Money.zero(currency) },
        ]),
      );

      const result = reconcileReceivables(
        ledger,
        pas.map((p) => ({ invoiceId: p.invoiceId, number: p.number, balance: writtenBalance(p) })),
        currency,
      );

      const drift = cacheDrift(await deps.reconciliations.cachedVsDerived(tx, ctx));

      const run: ReconciliationRecord = {
        id: newId(),
        asOf: clock.today("UTC"),
        ranAt: clock.now(),
        status: result.differences.length === 0 && drift.length === 0 ? "balanced" : "differences",
        ledgerTotal: result.ledgerTotal,
        pasTotal: result.pasTotal,
        invoices: result.invoices,
        differences: result.differences,
        cacheDrift: drift,
      };

      await deps.reconciliations.save(tx, ctx, run);

      await deps.audit.record(tx, ctx, {
        action: "ledger.reconciled",
        entityType: "reconciliation",
        entityId: run.id,
        actor: SYSTEM,
        before: null,
        after: { status: run.status, differences: run.differences.length, drift: drift.length },
        idempotencyKey: null,
        occurredAt: run.ranAt,
      });

      return run;
    });
  };
}

export type Reconcile = ReturnType<typeof makeReconcile>;

export interface ReconciliationWorkflowInput {
  day: string;
}

/** One reconciliation run for a tenant (PLAN §13); the nightly sweep reconciles every ledger. */
export const reconciliationWorkflow = workflowRef<ReconciliationWorkflowInput>(
  "ledger.reconciliation",
  {
    parse(value) {
      const day = (value as Partial<ReconciliationWorkflowInput> | null)?.day;

      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw invalid("ledger.reconciliation needs a day");
      }

      return { day };
    },
  },
);

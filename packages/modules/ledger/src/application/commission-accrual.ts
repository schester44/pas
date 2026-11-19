import type { ClockProvider, TenantContext, Transaction } from "@pas/kernel";
import { RECEIVABLE_ACCOUNTS } from "../domain/accounts";
import { CHARGE_KINDS, COLLECTION_KINDS, collectedCommission } from "../domain/commission";
import { JournalEntry } from "../domain/journal";
import { commissionLines, negate } from "../domain/posting-rules";
import type { CommissionRepository, JournalRepository } from "../ports/repositories";

type Deps = {
  journal: JournalRepository;
  commissions: CommissionRepository;
  clocks: ClockProvider;
};

const ACTOR = { type: "system" as const, name: "Native billing" };

/**
 * Brings collected-basis commission payable on a policy up (or down) to its collected share.
 * Keyed by the posting that changed the collection, so a repeated posting accrues once.
 */
export async function accrueCommission(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  input: { policyId: string; currency: string; trigger: string },
): Promise<void> {
  const totals = await deps.commissions.collectedTotals(tx, ctx, input.policyId);

  if (totals.length === 0) return;

  const { charged, collected } = await deps.commissions.collection(tx, ctx, {
    policyId: input.policyId,
    currency: input.currency,
    chargeKinds: [...CHARGE_KINDS],
    collectionKinds: [...COLLECTION_KINDS],
  });

  const clock = deps.clocks.forTenant(ctx.tenantId);

  for (const { agencyId, amount } of totals) {
    const target = collectedCommission({ commission: amount, charged, collected });

    const accrued = await deps.commissions.accrued(
      tx,
      ctx,
      input.policyId,
      agencyId,
      input.currency,
    );

    const delta = target.minus(accrued);

    if (delta.isZero()) continue;

    const lines = commissionLines(
      { agencyId, policyId: input.policyId },
      delta.isNegative() ? delta.negated() : delta,
    );

    await deps.journal.post(
      tx,
      ctx,
      JournalEntry.draft(
        {
          tenantId: ctx.tenantId,
          key: `commission-accrual:${agencyId}:${input.trigger}`,
          kind: "commission_accrual",
          source: { type: "policy", id: input.policyId },
          effectiveOn: clock.today("UTC"),
          actor: ACTOR,
          memo: delta.isNegative()
            ? "Commission payable reduced with premium no longer collected"
            : "Commission payable on premium collected",
          lines: delta.isNegative() ? negate(lines) : lines,
        },
        clock,
      ),
    );
  }
}

/** After a posting, the policies whose collected-basis commission may have moved. */
export function accrualTriggers(entry: JournalEntry): { policyId: string; currency: string }[] {
  const e = entry.toSnapshot();

  if (!CHARGE_KINDS.has(e.kind) && !COLLECTION_KINDS.has(e.kind)) return [];

  const seen = new Map<string, string>();

  for (const line of e.lines) {
    if (line.policyId && RECEIVABLE_ACCOUNTS.includes(line.account)) {
      seen.set(line.policyId, line.amount.currency);
    }
  }

  return [...seen].map(([policyId, currency]) => ({ policyId, currency }));
}

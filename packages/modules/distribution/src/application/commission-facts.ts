import type { TenantContext } from "@pas/kernel";
import type { DistributionDeps } from "./deps";

/**
 * Every recorded commission as the `distribution.commissions_recorded` fact it was published as,
 * one per transaction and agency, for a billing system catching up on facts it missed.
 */
export function makeCommissionFacts(
  deps: Pick<DistributionDeps, "uow" | "agencies" | "commissions">,
) {
  return async function commissionFacts(ctx: TenantContext) {
    return deps.uow.run(ctx, async (tx) => {
      const [rows, agencies] = await Promise.all([
        deps.commissions.list(tx, ctx, {}),
        deps.agencies.list(tx, ctx),
      ]);

      const basis = new Map(agencies.map((a) => [a.id as string, a.billing.commissionBasis]));
      const facts = new Map<string, (typeof rows)[number][]>();

      for (const row of rows) {
        if (!row.agencyId) continue;

        const key = `${row.transactionId}:${row.agencyId}`;
        facts.set(key, [...(facts.get(key) ?? []), row]);
      }

      return [...facts.values()].map((group) => {
        const first = group[0]!;

        return {
          occurredAt: first.recordedAt.toString(),
          policyId: first.policyId,
          transactionId: first.transactionId,
          agencyId: first.agencyId,
          commissionBasis: basis.get(first.agencyId!) ?? null,
          lines: group.map((r) => ({
            financialTransactionId: r.financialTransactionId,
            amount: r.amount.toJSON(),
          })),
        };
      });
    });
  };
}

export type CommissionFacts = ReturnType<typeof makeCommissionFacts>;

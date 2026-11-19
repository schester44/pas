import type { PrismaClient } from "@pas/db";
import { asId, type TenantContext } from "@pas/kernel";

type Create = (
  ctx: TenantContext,
  input: { policyId: string; transactionId: string },
) => Promise<unknown>;

interface Candidate {
  tenant_id: string;
  policy_id: string;
  id: string;
}

/**
 * Catches up issued transactions whose domain event a worker dropped: anything recent without
 * commission lines or obligations goes through the same idempotent creators again.
 */
export function makeReconcileIssued(deps: {
  prisma: PrismaClient;
  recordCommissions: Create;
  createObligations: Create;
}) {
  return async function reconcileIssued(input: { tenantId: string | null; days: number }) {
    const candidates = await deps.prisma.$queryRaw<Candidate[]>`
      SELECT t.tenant_id, t.policy_id, t.id::text AS id
      FROM policy_transactions t
      WHERE t.status = 'issued'
        AND t.recorded_at >= now() - make_interval(days => ${input.days}::int)
        AND (${input.tenantId}::text IS NULL OR t.tenant_id = ${input.tenantId}::text)
        AND (
          NOT EXISTS (SELECT 1 FROM commissions c WHERE c.tenant_id = t.tenant_id AND c.transaction_id = t.id)
          OR NOT EXISTS (
            SELECT 1 FROM compliance_obligations o
            WHERE o.tenant_id = t.tenant_id AND o.transaction_id = t.id
          )
        )
      ORDER BY t.recorded_at`;

    const failed: { transactionId: string; error: string }[] = [];

    for (const t of candidates) {
      const ctx: TenantContext = {
        tenantId: asId(t.tenant_id),
        actor: { type: "system", process: "reconciliation" },
      };

      const target = { policyId: t.policy_id, transactionId: t.id };

      try {
        await deps.recordCommissions(ctx, target);
        await deps.createObligations(ctx, target);
      } catch (error) {
        failed.push({ transactionId: t.id, error: String(error) });
      }
    }

    return { checked: candidates.length, failed };
  };
}

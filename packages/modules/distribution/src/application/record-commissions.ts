import { newId, type TenantContext } from "@pas/kernel";
import { commissionsOn, scheduleFor } from "../domain/commission";
import type { CommissionRecord } from "../ports/commission-repository";
import type { PolicyFinancials } from "../ports/policy-financials";
import type { DistributionDeps } from "./deps";

/**
 * PLAN §13: commission on each premium financial transaction of an issued policy transaction,
 * at the agency of record's tier. Idempotent: lines already recorded are skipped.
 */
export function makeRecordCommissions(
  deps: Pick<DistributionDeps, "uow" | "agencies" | "commissions" | "clocks"> & {
    financials: PolicyFinancials;
  },
) {
  return async function recordCommissions(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<{ recorded: number }> {
    const financials = await deps.financials.transaction(ctx, input);

    if (!financials || financials.lines.length === 0) return { recorded: 0 };

    return deps.uow.run(ctx, async (tx) => {
      const [schedules, agency] = await Promise.all([
        deps.commissions.schedules(tx, ctx),
        financials.agencyId ? deps.agencies.findById(tx, ctx, financials.agencyId) : null,
      ]);

      const business = financials.termNumber > 1 ? "renewal" : "new";

      const schedule = scheduleFor(schedules, {
        productId: financials.productId,
        country: financials.country,
        subdivision: financials.subdivision,
        business,
        tier: agency?.tier ?? "standard",
        on: financials.effectiveDate,
      });

      const now = deps.clocks.forTenant(ctx.tenantId).now();

      const rows: CommissionRecord[] = commissionsOn(financials.lines, schedule).map((line) => ({
        id: newId(),
        ...line,
        transactionId: financials.transactionId,
        transactionType: financials.transactionType,
        policyId: financials.policyId,
        policyNumber: financials.policyNumber,
        insuredName: financials.insuredName,
        agencyId: financials.agencyId,
        producerId: financials.producerId,
        business,
        effectiveDate: financials.effectiveDate,
        recordedAt: now,
      }));

      return { recorded: await deps.commissions.record(tx, ctx, rows) };
    });
  };
}

export type RecordCommissions = ReturnType<typeof makeRecordCommissions>;

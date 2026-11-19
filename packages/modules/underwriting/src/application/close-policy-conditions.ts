import type { TenantContext } from "@pas/kernel";
import { isCleared } from "../domain/subjectivity";
import { clockOf, persist, type UnderwritingDeps } from "./deps";

const SYSTEM = { type: "system" as const, name: "Underwriting" };

/**
 * The policy ended, so nothing is owed on it any more: open subjectivities are waived and pending
 * inspections are called off with the vendor. Safe to repeat; returns every condition on the policy.
 */
export function makeClosePolicyConditions(deps: UnderwritingDeps) {
  return async function closePolicyConditions(
    ctx: TenantContext,
    input: { policyId: string; reason: string },
  ): Promise<{ subjectivityIds: string[]; inspectionIds: string[] }> {
    const { subjectivities, inspections } = await deps.uow.run(ctx, async (tx) => ({
      subjectivities: await deps.subjectivities.listByPolicy(tx, ctx, input.policyId),
      inspections: await deps.inspections.listByPolicy(tx, ctx, input.policyId),
    }));

    for (const subjectivity of subjectivities.filter((s) => !isCleared(s.status))) {
      await deps.uow.run(ctx, async (tx) => {
        const s = (await deps.subjectivities.findById(tx, ctx, subjectivity.id))!;

        if (isCleared(s.status)) return;

        s.waive({ id: null, name: SYSTEM.name }, input.reason, clockOf(deps, ctx));
        await persist(deps, tx, s);

        const snap = s.toSnapshot();

        await deps.timeline.record(tx, ctx, {
          quoteId: snap.quoteId,
          policyId: snap.policyId,
          type: "subjectivity_cleared",
          actor: SYSTEM,
          summary: `${snap.title} waived: ${input.reason.toLowerCase()}`,
          data: { subjectivityId: snap.id, status: snap.status, reason: input.reason },
        });
      });
    }

    for (const inspection of inspections.filter((i) => i.pending)) {
      const providerRef = inspection.toSnapshot().providerRef;

      if (providerRef) await (await deps.inspectors.for(ctx)).cancel(ctx, providerRef);

      await deps.uow.run(ctx, async (tx) => {
        const i = (await deps.inspections.findById(tx, ctx, inspection.id))!;

        if (!i.cancel(input.reason, clockOf(deps, ctx))) return;

        await persist(deps, tx, i);

        const snap = i.toSnapshot();

        await deps.timeline.record(tx, ctx, {
          quoteId: snap.quoteId,
          policyId: snap.policyId,
          type: "inspection_cancelled",
          actor: SYSTEM,
          summary: `Inspection cancelled${snap.providerId ? ` with ${snap.providerId}` : ""}: ${input.reason.toLowerCase()}`,
          data: { inspectionId: snap.id, providerRef: snap.providerRef, reason: input.reason },
        });
      });
    }

    return {
      subjectivityIds: subjectivities.map((s) => s.id),
      inspectionIds: inspections.map((i) => i.id),
    };
  };
}

import type { TenantContext, Transaction } from "@pas/kernel";
import type { Inspection, InspectionId, InspectionStatus } from "../domain/inspection";
import type { InspectionStatusReport } from "../ports/inspection-provider";
import type { UnderwritingTimelineType } from "../ports/timeline";
import { clockOf, loadInspection, persist, type UnderwritingDeps } from "./deps";

const LABEL: Record<string, string> = {
  exterior: "Exterior inspection",
  interior_exterior: "Interior and exterior inspection",
  aerial: "Aerial imagery review",
  field: "Field inspection",
};

const TIMELINE: Partial<Record<InspectionStatus, UnderwritingTimelineType>> = {
  ordered: "inspection_ordered",
  scheduled: "inspection_scheduled",
  completed: "inspection_completed",
};

const day = (i: Temporal.Instant | null) => (i ? i.toString().slice(0, 10) : "");

/** What the `underwriting.inspection` workflow reads and does on its timers. */
export function makeInspectionTimers(deps: UnderwritingDeps) {
  async function record(
    tx: Transaction,
    ctx: TenantContext,
    inspection: Inspection,
    status: InspectionStatus,
  ) {
    const type = TIMELINE[status];
    const s = inspection.toSnapshot();

    if (!type) return;

    const findings = s.report?.findings.length ?? 0;

    const summary = {
      ordered: `${LABEL[s.type]} ordered from ${s.providerId}`,
      scheduled: `${LABEL[s.type]} scheduled for ${day(s.scheduledFor)}`,
      completed: `${LABEL[s.type]} completed with ${findings} findings; an underwriter will review them`,
    }[status as "ordered" | "scheduled" | "completed"];

    await deps.timeline.record(tx, ctx, {
      quoteId: s.quoteId,
      policyId: s.policyId,
      type,
      actor: { type: "system", name: s.providerId ?? "Inspections" },
      summary,
      data: { inspectionId: s.id, providerRef: s.providerRef },
    });
  }

  async function applyReport(
    ctx: TenantContext,
    id: string,
    report: InspectionStatusReport,
    ordered?: { provider: string; ref: string },
  ) {
    return deps.uow.run(ctx, async (tx) => {
      const inspection = await loadInspection(deps, tx, ctx, id);
      const clock = clockOf(deps, ctx);
      const changes: InspectionStatus[] = [];

      if (ordered && inspection.status === "requested") {
        inspection.ordered({ id: ordered.provider, ref: ordered.ref }, clock);
        changes.push("ordered");
      }

      const applied = inspection.apply(report, clock);

      if (applied) changes.push(applied);

      await persist(deps, tx, inspection);

      for (const status of changes) await record(tx, ctx, inspection, status);

      return { done: !inspection.pending, nextCheckAt: report.nextCheckAt?.toString() ?? null };
    });
  }

  return {
    async order(ctx: TenantContext, input: { inspectionId: string }) {
      const inspection = await deps.uow.run(ctx, (tx) =>
        loadInspection(deps, tx, ctx, input.inspectionId),
      );

      const s = inspection.toSnapshot();

      if (s.status !== "requested") return { done: !inspection.pending, nextCheckAt: null };

      const provider = await deps.inspectors.for(ctx);

      const result = await provider.order(ctx, {
        reference: s.id,
        type: s.type,
        address: s.address,
        policyNumber: s.policyNumber,
        insuredName: null,
      });

      return applyReport(ctx, s.id, result, {
        provider: provider.provider,
        ref: result.providerRef,
      });
    },

    async check(ctx: TenantContext, input: { inspectionId: string }) {
      const inspection = await deps.uow.run(ctx, (tx) =>
        loadInspection(deps, tx, ctx, input.inspectionId),
      );

      const s = inspection.toSnapshot();

      if (!inspection.pending || !s.providerRef) return { done: true, nextCheckAt: null };

      const provider = await deps.inspectors.for(ctx);

      return applyReport(ctx, s.id, await provider.check(ctx, s.providerRef));
    },

    msUntil(ctx: TenantContext, at: string): number {
      return Math.max(
        0,
        clockOf(deps, ctx).now().until(Temporal.Instant.from(at)).total("milliseconds"),
      );
    },

    async describe(ctx: TenantContext, input: { inspectionId: string }) {
      const inspection = await deps.uow.run(ctx, (tx) =>
        deps.inspections.findById(tx, ctx, input.inspectionId as InspectionId),
      );

      const s = inspection?.toSnapshot();

      return s
        ? { label: LABEL[s.type] ?? "Inspection", reference: s.policyNumber ?? s.submissionNumber }
        : null;
    },
  };
}

export type InspectionTimers = ReturnType<typeof makeInspectionTimers>;

import type { TenantContext } from "@pas/kernel";
import type { SubjectivityId } from "../domain/subjectivity";
import { clockOf, loadSubjectivity, persist, type UnderwritingDeps } from "./deps";

const SYSTEM = { type: "system" as const, name: "Underwriting" };

/** What the `underwriting.subjectivity` workflow reads and does on its timer. */
export function makeSubjectivityTimers(deps: UnderwritingDeps) {
  return {
    /** Overdue from the start of the day after the due date; null when nothing is due. */
    async lateAt(ctx: TenantContext, input: { subjectivityId: string }): Promise<string | null> {
      const s = (
        await deps.uow.run(ctx, (tx) => loadSubjectivity(deps, tx, ctx, input.subjectivityId))
      ).toSnapshot();

      if (!s.dueDate || s.status !== "open") return null;

      return s.dueDate.add({ days: 1 }).toZonedDateTime({ timeZone: "UTC" }).toInstant().toString();
    },

    msUntil(ctx: TenantContext, at: string): number {
      return Math.max(
        0,
        clockOf(deps, ctx).now().until(Temporal.Instant.from(at)).total("milliseconds"),
      );
    },

    async fire(ctx: TenantContext, input: { subjectivityId: string }): Promise<{ status: string }> {
      return deps.uow.run(ctx, async (tx) => {
        const s = await loadSubjectivity(deps, tx, ctx, input.subjectivityId);
        const clock = clockOf(deps, ctx);

        if (!s.markOverdue(clock.today("UTC"), clock)) return { status: s.status };

        const snap = s.toSnapshot();

        await persist(deps, tx, s);

        await deps.timeline.record(tx, ctx, {
          quoteId: snap.quoteId,
          policyId: snap.policyId,
          type: "subjectivity_overdue",
          actor: SYSTEM,
          summary: `${snap.title} is overdue${snap.consequence ? `. ${snap.consequence}` : ""}`,
          data: {
            subjectivityId: snap.id,
            dueDate: snap.dueDate?.toString(),
            consequence: snap.consequence,
          },
        });

        return { status: "overdue" };
      });
    },

    async describe(ctx: TenantContext, input: { subjectivityId: string }) {
      const s = await deps.uow.run(ctx, (tx) =>
        deps.subjectivities.findById(tx, ctx, input.subjectivityId as SubjectivityId),
      );

      const snap = s?.toSnapshot();

      return snap
        ? { title: snap.title, reference: snap.policyNumber ?? snap.submissionNumber }
        : null;
    },
  };
}

export type SubjectivityTimers = ReturnType<typeof makeSubjectivityTimers>;

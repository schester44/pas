import { defineWorkflow, type TenantContext } from "@pas/kernel";
import {
  type InspectionTimers,
  inspectionWorkflow,
  type SubjectivityTimers,
  subjectivityWorkflow,
} from "@pas/underwriting";

const MAX_CHECKS = 60;
const RECHECK_SECONDS = 6 * 60 * 60;

const contextFor = (tenantId: TenantContext["tenantId"], process: string): TenantContext => ({
  tenantId,
  actor: { type: "system", process },
});

/** Orders the inspection, then checks back when the vendor expects a change (PLAN §11). */
export function makeInspectionWorkflow(deps: { timers: InspectionTimers }) {
  return defineWorkflow(inspectionWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextFor(tenantId, inspectionWorkflow.id);
    let state = await step.run("order", () => deps.timers.order(ctx, input));

    for (let check = 1; !state.done && check <= MAX_CHECKS; check++) {
      const at = state.nextCheckAt;

      const wait = await step.run(`until-${check}`, async () =>
        at ? deps.timers.msUntil(ctx, at) : RECHECK_SECONDS * 1000,
      );

      if (wait > 0) await step.delay(`wait-${check}`, { seconds: Math.ceil(wait / 1000) });

      state = await step.run(`check-${check}`, () => deps.timers.check(ctx, input));
    }

    return { status: state.done ? "completed" : "gave_up" };
  });
}

/** Waits out a post-bind subjectivity's due date and raises it if it's still open. */
export function makeSubjectivityWorkflow(deps: { timers: SubjectivityTimers }) {
  return defineWorkflow(subjectivityWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextFor(tenantId, subjectivityWorkflow.id);
    const lateAt = await step.run("plan", () => deps.timers.lateAt(ctx, input));

    if (!lateAt) return { status: "not_due" };

    const wait = await step.run("until-due", async () => deps.timers.msUntil(ctx, lateAt));

    if (wait > 0) await step.delay("wait-due", { seconds: Math.ceil(wait / 1000) });

    return step.run("overdue", () => deps.timers.fire(ctx, input));
  });
}

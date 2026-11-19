import { filingWorkflow, obligationWorkflow, type ObligationTimers } from "@pas/compliance";
import { defineWorkflow, type TenantContext } from "@pas/kernel";

const contextFor = (tenantId: TenantContext["tenantId"]): TenantContext => ({
  tenantId,
  actor: { type: "system", process: "compliance.obligation" },
});

/** Reminder, overdue and escalation on the obligation's own dates; stops once it's met (PLAN §17.1). */
export function makeObligationWorkflow(deps: { timers: ObligationTimers }) {
  return defineWorkflow(obligationWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextFor(tenantId);
    const steps = await step.run("plan", () => deps.timers.steps(ctx, input));
    let status = "pending";

    for (const s of steps) {
      const wait = await step.run(`until-${s.id}`, async () => deps.timers.msUntil(ctx, s.at));

      if (wait > 0) await step.delay(`wait-${s.id}`, { seconds: Math.ceil(wait / 1000) });

      const result = await step.run(s.id, () =>
        deps.timers.fire(ctx, { obligationId: input.obligationId, step: s }),
      );

      status = result.status;

      if (result.done) break;
    }

    return { status };
  });
}

/** Asks an API channel for its answer until the filing is accepted or rejected. */
export function makeFilingWorkflow(deps: { timers: ObligationTimers }) {
  return defineWorkflow(filingWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextFor(tenantId);
    const seconds = await step.run("plan", () => deps.timers.pollAfterSeconds(ctx, input));

    if (seconds === null) return { status: "settled" };

    for (let attempt = 1; ; attempt++) {
      await step.delay(`wait-${attempt}`, { seconds });

      if (await step.run(`poll-${attempt}`, () => deps.timers.poll(ctx, { ...input, attempt }))) {
        return { status: "settled" };
      }
    }
  });
}

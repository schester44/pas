import { defineWorkflow, type TenantContext } from "@pas/kernel";
import { policyCancellationWorkflow, type TermTimers } from "@pas/policy";

/** pending_cancellation → cancelled on the cancellation date, unless rescinded first (PLAN §7.3). */
export function makePolicyCancellationWorkflow(deps: { timers: TermTimers }) {
  return defineWorkflow(policyCancellationWorkflow, async ({ input, tenantId, step }) => {
    const ctx: TenantContext = {
      tenantId,
      actor: { type: "system", process: "policy.cancellation" },
    };

    const wait = await step.run("schedule", () => deps.timers.msUntilCancellation(ctx, input));

    if (wait === null) return { status: "not_scheduled" };

    if (wait > 0) await step.delay("cancellation-date", { seconds: Math.ceil(wait / 1000) });

    const status = await step.run("cancel", () => deps.timers.effectCancellation(ctx, input));

    return { status };
  });
}

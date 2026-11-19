import { defineWorkflow, type TenantContext } from "@pas/kernel";
import { policyCancellationWorkflow, type TermTimers } from "@pas/policy";

const PROOF_CHECKS = 30;

/**
 * pending_cancellation → cancelled on the cancellation date, unless rescinded first (PLAN §7.3).
 * A mailed notice without proof of mailing holds the cancellation; it's checked again daily.
 */
export function makePolicyCancellationWorkflow(deps: { timers: TermTimers }) {
  return defineWorkflow(policyCancellationWorkflow, async ({ input, tenantId, step }) => {
    const ctx: TenantContext = {
      tenantId,
      actor: { type: "system", process: "policy.cancellation" },
    };

    const wait = await step.run("schedule", () => deps.timers.msUntilCancellation(ctx, input));

    if (wait === null) return { status: "not_scheduled" };

    if (wait > 0) await step.delay("cancellation-date", { seconds: Math.ceil(wait / 1000) });

    let status = await step.run("cancel", () => deps.timers.effectCancellation(ctx, input));

    for (let check = 1; status === "held" && check <= PROOF_CHECKS; check++) {
      await step.delay(`proof-${check}`, { seconds: 24 * 60 * 60 });
      status = await step.run(`cancel-${check}`, () => deps.timers.effectCancellation(ctx, input));
    }

    return { status };
  });
}

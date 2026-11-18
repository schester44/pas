import { defineWorkflow, type TenantContext } from "@pas/kernel";
import { policyTermWorkflow, type TermTimers } from "@pas/policy";

/** pending_effective → in_force on the effective date (PLAN §7.3). */
export function makePolicyTermWorkflow(deps: { timers: TermTimers }) {
  return defineWorkflow(policyTermWorkflow, async ({ input, tenantId, step }) => {
    const ctx: TenantContext = { tenantId, actor: { type: "system", process: "policy.term" } };
    const wait = await step.run("schedule", () => deps.timers.msUntilEffective(ctx, input));

    if (wait > 0) await step.delay("effective-date", { seconds: Math.ceil(wait / 1000) });

    const status = await step.run("activate", () => deps.timers.activate(ctx, input));

    return { status };
  });
}

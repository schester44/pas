import { installmentWorkflow, type InstallmentTimers } from "@pas/billing";
import { defineWorkflow, type TenantContext } from "@pas/kernel";

/** One installment through its dates: open, autopay, past due, retries, reminder, grace (PLAN §13). */
export function makeInstallmentWorkflow(deps: { timers: InstallmentTimers }) {
  return defineWorkflow(installmentWorkflow, async ({ input, tenantId, step }) => {
    const ctx: TenantContext = {
      tenantId,
      actor: { type: "system", process: "billing.installment" },
    };

    const steps = await step.run("plan", () => deps.timers.steps(ctx, input));
    let status = "scheduled";

    for (const s of steps) {
      const wait = await step.run(`until-${s.id}`, async () => deps.timers.msUntil(ctx, s.on));

      if (wait > 0) await step.delay(`wait-${s.id}`, { seconds: Math.ceil(wait / 1000) });

      const result = await step.run(s.id, () =>
        deps.timers.run(ctx, { invoiceId: input.invoiceId, step: s }),
      );

      status = result.status;

      if (result.done) break;
    }

    return { status };
  });
}

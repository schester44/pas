import {
  type AgencyStatements,
  agencyAccountWorkflow,
  type MortgageeBilling,
  mortgageeBillWorkflow,
} from "@pas/billing";
import { defineWorkflow, type TenantContext } from "@pas/kernel";

type Timers = { msUntil(ctx: TenantContext, on: string): number };

const contextOf = (tenantId: TenantContext["tenantId"], process: string): TenantContext => ({
  tenantId,
  actor: { type: "system", process },
});

/** One agency's account current: issued after the cut-off, then aged until paid (PLAN §13). */
export function makeAgencyAccountWorkflow(deps: { statements: AgencyStatements; timers: Timers }) {
  return defineWorkflow(agencyAccountWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextOf(tenantId, agencyAccountWorkflow.id);
    const issueOn = Temporal.PlainDate.from(input.cutoff).add({ days: 1 }).toString();
    const wait = await step.run("until-cutoff", async () => deps.timers.msUntil(ctx, issueOn));

    if (wait > 0) await step.delay("wait-cutoff", { seconds: Math.ceil(wait / 1000) });

    const statementId = await step.run("generate", () => deps.statements.generate(ctx, input));

    if (!statementId) return { status: "nothing_due" };

    await step.run("publish", () => deps.statements.publish(ctx, { statementId }));

    const plan = await step.run("aging", () => deps.statements.agingPlan(ctx, { statementId }));
    let status = "open";

    for (const s of plan) {
      const ms = await step.run(`until-${s.id}`, async () => deps.timers.msUntil(ctx, s.on));

      if (ms > 0) await step.delay(`wait-${s.id}`, { seconds: Math.ceil(ms / 1000) });

      const result = await step.run(s.id, () =>
        deps.statements.age(ctx, { statementId, action: s.action }),
      );

      status = result.status;

      if (result.done) break;
    }

    return { status };
  });
}

/** A lender's bill: the packet, reminders, the direct-bill offer, then nonpayment (PLAN §13). */
export function makeMortgageeBillWorkflow(deps: { mortgagee: MortgageeBilling; timers: Timers }) {
  return defineWorkflow(mortgageeBillWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextOf(tenantId, mortgageeBillWorkflow.id);
    const target = { mortgageeBillId: input.mortgageeBillId };
    const sentOn = await step.run("packet", () => deps.mortgagee.sendPacket(ctx, target));

    if (!sentOn) return { status: "not_sent" };

    const steps = await step.run("plan", () => deps.mortgagee.steps(ctx, target));
    let status = "awaiting_payment";

    for (const s of steps) {
      const ms = await step.run(`until-${s.id}`, async () => deps.timers.msUntil(ctx, s.on));

      if (ms > 0) await step.delay(`wait-${s.id}`, { seconds: Math.ceil(ms / 1000) });

      const result = await step.run(s.id, () =>
        deps.mortgagee.run(ctx, { ...target, action: s.action, sentOn }),
      );

      status = result.status;

      if (result.done) break;
    }

    return { status };
  });
}

import { type NightlyBatch, nightlyBatchWorkflow } from "@pas/agency-downloads";
import { defineWorkflow, type TenantContext } from "@pas/kernel";

const contextOf = (tenantId: TenantContext["tenantId"]): TenantContext => ({
  tenantId,
  actor: { type: "system", process: nightlyBatchWorkflow.id },
});

/** One night's agency downloads: wait for the tenant's batch time, send, book the next night. */
export function makeNightlyBatchWorkflow(deps: { nightly: NightlyBatch }) {
  return defineWorkflow(nightlyBatchWorkflow, async ({ input, tenantId, step }) => {
    const ctx = contextOf(tenantId);
    const wait = await step.run("until-batch", () => deps.nightly.msUntil(ctx, input));

    if (wait > 0) await step.delay("wait-batch", { seconds: Math.ceil(wait / 1000) });

    const result = await step.run("send", () => deps.nightly.run(ctx, input));
    const next = result.next;

    if (next) await step.run("book-next", () => deps.nightly.schedule(ctx, { after: next }));

    return { status: result.status, delivered: result.delivered, failed: result.failed };
  });
}

import { z } from "zod";
import { requirePermission, router } from "./init";

const manage = requirePermission({ organization: ["update"] });
const byRun = z.object({ runId: z.uuid() });

const STATUSES = ["pending", "running", "waiting", "completed", "failed", "cancelled"] as const;

/** Settings → Developers → Workflows: the tenant's durable runs and operator actions. */
export const workflowsRouter = router({
  list: manage
    .input(
      z.object({
        workflowId: z.string().max(80).optional(),
        status: z.enum(STATUSES).optional(),
        subject: z.string().max(120).optional(),
        q: z.string().trim().max(80).optional(),
        before: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.container.useCases.workflowRuns.list(ctx.tenant, {
        ...input,
        q: input.q || undefined,
        before: input.before ? Temporal.Instant.from(input.before) : undefined,
      }),
    ),
  get: manage
    .input(byRun)
    .query(({ ctx, input }) => ctx.container.useCases.workflowRuns.get(ctx.tenant, input)),
  retry: manage
    .input(byRun)
    .mutation(({ ctx, input }) => ctx.container.useCases.workflowRuns.retry(ctx.tenant, input)),
  cancel: manage
    .input(byRun.extend({ reason: z.string().trim().min(1).max(300) }))
    .mutation(({ ctx, input }) => ctx.container.useCases.workflowRuns.cancel(ctx.tenant, input)),
  wakeNow: manage
    .input(byRun)
    .mutation(({ ctx, input }) => ctx.container.useCases.workflowRuns.wakeNow(ctx.tenant, input)),
  reconcile: manage
    .input(z.object({ days: z.number().int().min(1).max(3660) }))
    .mutation(({ ctx, input }) => ctx.container.useCases.workflowRuns.reconcile(ctx.tenant, input)),
});

import { z } from "zod";
import { requirePermission, router } from "./init";

const manage = requirePermission({ organization: ["update"] });
const byProvider = z.object({ providerId: z.string().min(1).max(64) });

/** Settings → Integrations: the catalog and each provider's install. */
export const integrationsRouter = router({
  list: manage.query(({ ctx }) => ctx.container.integrations.list(ctx.tenant)),
  get: manage
    .input(byProvider)
    .query(({ ctx, input }) => ctx.container.integrations.get(ctx.tenant, input)),
  configure: manage
    .input(
      byProvider.extend({
        environment: z.enum(["test", "live"]),
        config: z.record(z.string(), z.unknown()),
        secrets: z.record(z.string(), z.string().max(4000)),
      }),
    )
    .mutation(({ ctx, input }) => ctx.container.integrations.configure(ctx.tenant, input)),
  setStatus: manage
    .input(byProvider.extend({ enabled: z.boolean() }))
    .mutation(({ ctx, input }) => ctx.container.integrations.setStatus(ctx.tenant, input)),
  test: manage
    .input(byProvider)
    .mutation(({ ctx, input }) => ctx.container.integrations.test(ctx.tenant, input)),
});

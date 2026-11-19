import { eventAudience } from "@pas/auth";
import type { TenantContext } from "@pas/kernel";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Context } from "./context";
import { requirePermission, router, tenantProcedure } from "./init";

const manage = requirePermission({ organization: ["update"] });
const byId = z.object({ id: z.uuid() });
const kind = z.enum(["webhook", "chat"]);

const settings = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().max(2048).nullable(),
  eventTypes: z.array(z.string().max(80)).min(1).max(40),
  filter: z.string().max(2000).nullable(),
});

/** Settings → Developers (webhooks, event catalog) and the Slack destinations in Notifications. */
export const eventsRouter = router({
  catalog: tenantProcedure.query(({ ctx }) => ctx.container.events.catalog()),
  subscriptions: router({
    list: manage
      .input(z.object({ kind }))
      .query(({ ctx, input }) => ctx.container.events.subscriptions.list(ctx.tenant, input)),
    get: manage
      .input(byId)
      .query(({ ctx, input }) => ctx.container.events.subscriptions.get(ctx.tenant, input)),
    create: manage
      .input(settings.extend({ kind }))
      .mutation(({ ctx, input }) => ctx.container.events.subscriptions.create(ctx.tenant, input)),
    update: manage
      .input(settings.extend(byId.shape))
      .mutation(({ ctx, input }) => ctx.container.events.subscriptions.update(ctx.tenant, input)),
    setStatus: manage
      .input(byId.extend({ active: z.boolean() }))
      .mutation(({ ctx, input }) =>
        ctx.container.events.subscriptions.setStatus(ctx.tenant, input),
      ),
    rotateSecret: manage
      .input(byId)
      .mutation(({ ctx, input }) =>
        ctx.container.events.subscriptions.rotateSecret(ctx.tenant, input),
      ),
    remove: manage
      .input(byId)
      .mutation(({ ctx, input }) => ctx.container.events.subscriptions.remove(ctx.tenant, input)),
    delivery: manage
      .input(byId)
      .query(({ ctx, input }) => ctx.container.events.subscriptions.delivery(ctx.tenant, input)),
    replay: manage
      .input(z.object({ deliveryId: z.uuid() }))
      .mutation(({ ctx, input }) => ctx.container.events.subscriptions.replay(ctx.tenant, input)),
    sendTest: manage
      .input(byId.extend({ type: z.string().max(80) }))
      .mutation(({ ctx, input }) => ctx.container.events.subscriptions.sendTest(ctx.tenant, input)),
  }),
});

type Authed = Context & { session: NonNullable<Context["session"]> };

const audienceOf = async (ctx: Authed, tenant: TenantContext) => {
  const { role } = await ctx.container.auth.api.getActiveMemberRole({
    headers: ctx.headers,
    query: { organizationId: tenant.tenantId },
  });

  const { audience } = eventAudience(role);

  if (!audience) throw new TRPCError({ code: "FORBIDDEN" });

  return audience;
};

/** The caller's own feed; admin passes the active org, the agent app the host's tenant. */
export function notificationsRouter(procedure: typeof tenantProcedure) {
  return router({
    feed: procedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
      .query(({ ctx, input }) => ctx.container.events.notifications.feed(ctx.tenant, input)),
    unread: procedure.query(({ ctx }) =>
      ctx.container.events.notifications.unreadCount(ctx.tenant),
    ),
    markRead: procedure
      .input(z.object({ ids: z.union([z.array(z.uuid()).max(100), z.literal("all")]) }))
      .mutation(({ ctx, input }) => ctx.container.events.notifications.markRead(ctx.tenant, input)),
    preferences: procedure.query(async ({ ctx }) => {
      return ctx.container.events.notifications.preferences(ctx.tenant, {
        audience: await audienceOf(ctx, ctx.tenant),
      });
    }),
    setPreferences: procedure
      .input(z.object({ eventTypes: z.array(z.string().max(80)).max(40) }))
      .mutation(({ ctx, input }) =>
        ctx.container.events.notifications.setPreferences(ctx.tenant, input),
      ),
  });
}

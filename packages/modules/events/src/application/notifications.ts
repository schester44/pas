import type { TenantContext } from "@pas/kernel";
import {
  type Audience,
  DEFAULT_IN_APP,
  PUBLIC_EVENT_TYPES,
  STAFF_ONLY,
} from "../domain/event-types";
import { inAppTypesFor } from "../domain/recipients";
import { catalogEntry } from "./catalog";
import type { EventsDeps } from "./deps";
import { toNotificationDto } from "./dto";

const userOf = (ctx: TenantContext) => {
  if (ctx.actor.type !== "user") throw new Error("Notifications belong to a signed-in user");

  return ctx.actor.userId;
};

/** The caller's in-app feed and which event types they get (PLAN §15.8). */
export function makeNotifications(deps: Pick<EventsDeps, "uow" | "notifications" | "clocks">) {
  return {
    async feed(ctx: TenantContext, input: { limit: number; unreadOnly?: boolean }) {
      const userId = userOf(ctx);

      return deps.uow.run(ctx, async (tx) => {
        const [items, unread] = await Promise.all([
          deps.notifications.list(tx, ctx, {
            userId,
            limit: input.limit,
            unreadOnly: input.unreadOnly ?? false,
          }),
          deps.notifications.unreadCount(tx, ctx, userId),
        ]);

        return { items: items.map(toNotificationDto), unread };
      });
    },

    async unreadCount(ctx: TenantContext) {
      return deps.uow.run(ctx, (tx) => deps.notifications.unreadCount(tx, ctx, userOf(ctx)));
    },

    async markRead(ctx: TenantContext, input: { ids: readonly string[] | "all" }) {
      await deps.uow.run(ctx, (tx) =>
        deps.notifications.markRead(tx, ctx, {
          userId: userOf(ctx),
          ids: input.ids,
          at: deps.clocks.forTenant(ctx.tenantId).now(),
        }),
      );
    },

    async preferences(ctx: TenantContext, input: { audience: Audience }) {
      const userId = userOf(ctx);

      const chosen = await deps.uow.run(ctx, (tx) =>
        deps.notifications.preferences(tx, ctx, [userId]),
      );

      const selected = inAppTypesFor(input.audience, chosen.get(userId) ?? null);

      return {
        audience: input.audience,
        customized: chosen.has(userId),
        types: PUBLIC_EVENT_TYPES.filter(
          (type) => input.audience === "staff" || !STAFF_ONLY.includes(type),
        ).map((type) => ({
          type,
          title: catalogEntry(type).title,
          description: catalogEntry(type).description,
          enabled: selected.includes(type),
          byDefault: DEFAULT_IN_APP[input.audience].includes(type),
        })),
      };
    },

    async setPreferences(ctx: TenantContext, input: { eventTypes: string[] }) {
      const userId = userOf(ctx);
      const known = new Set<string>(PUBLIC_EVENT_TYPES);

      await deps.uow.run(ctx, (tx) =>
        deps.notifications.savePreferences(tx, ctx, {
          userId,
          eventTypes: input.eventTypes.filter((t) => known.has(t)),
          at: deps.clocks.forTenant(ctx.tenantId).now(),
        }),
      );
    },
  };
}

export type Notifications = ReturnType<typeof makeNotifications>;

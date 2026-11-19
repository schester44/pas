import type { TenantContext } from "@pas/kernel";
import { type AuthorityProfile, profileOf } from "../domain/authority";
import type { ReferralStatus } from "../domain/referral";
import type { ReferralFilter } from "../ports/repositories";
import { clockOf, type UnderwritingDeps } from "./deps";
import { type ReferralSummaryDto, toReferralSummary } from "./dto";

export const QUEUE_VIEWS = [
  "open",
  "mine",
  "unassigned",
  "escalated",
  "waiting",
  "decided",
] as const;

export type QueueView = (typeof QUEUE_VIEWS)[number];

const IN_QUEUE: ReferralStatus[] = ["open", "escalated", "info_requested"];

export interface QueueInput {
  view?: QueueView;
  productId?: string;
  jurisdiction?: string;
  olderThanHours?: number;
  assigneeId?: string;
}

export interface MyAuthority {
  userId: string | null;
  profile: { key: string; name: string; level: number } | null;
}

export async function authorityOf(
  deps: Pick<UnderwritingDeps, "staff">,
  ctx: TenantContext,
  profiles: readonly AuthorityProfile[],
): Promise<MyAuthority> {
  if (ctx.actor.type !== "user") return { userId: null, profile: null };

  const member = await deps.staff.member(ctx, ctx.actor.userId);
  const profile = member && profileOf(profiles, { userId: member.userId, roles: member.roles });

  return {
    userId: ctx.actor.userId,
    profile: profile ? { key: profile.key, name: profile.name, level: profile.level } : null,
  };
}

/** The underwriter queue (PLAN §11): filter by product, state, age and assignee. */
export function makeListReferrals(deps: UnderwritingDeps) {
  return async function listReferrals(
    ctx: TenantContext,
    input: QueueInput,
  ): Promise<{ items: ReferralSummaryDto[]; counts: Record<QueueView, number>; me: MyAuthority }> {
    const now = clockOf(deps, ctx).now();
    const settings = await deps.uow.run(ctx, (tx) => deps.settings.get(tx, ctx));
    const me = await authorityOf(deps, ctx, settings.authorityProfiles);

    const base: ReferralFilter = {
      ...(input.productId && { productId: input.productId }),
      ...(input.jurisdiction && { jurisdiction: input.jurisdiction }),
      ...(input.assigneeId && { assigneeId: input.assigneeId }),
      ...(input.olderThanHours && {
        openedBefore: now.subtract({ hours: input.olderThanHours }),
      }),
    };

    const all = await deps.uow.run(ctx, (tx) =>
      deps.referrals.list(tx, ctx, { ...base, limit: 500 }),
    );

    const views: Record<QueueView, (s: ReturnType<(typeof all)[number]["toSnapshot"]>) => boolean> =
      {
        open: (r) => IN_QUEUE.includes(r.status),
        mine: (r) => IN_QUEUE.includes(r.status) && r.assignee?.id === me.userId,
        unassigned: (r) => r.status === "open" && !r.assignee,
        escalated: (r) => r.status === "escalated",
        waiting: (r) => r.status === "info_requested",
        decided: (r) => !IN_QUEUE.includes(r.status),
      };

    const snapshots = all.map((r) => ({ referral: r, s: r.toSnapshot() }));
    const view = input.view ?? "open";

    const counts = Object.fromEntries(
      Object.entries(views).map(([key, test]) => [
        key,
        snapshots.filter(({ s }) => test(s)).length,
      ]),
    ) as Record<QueueView, number>;

    const items = snapshots
      .filter(({ s }) => views[view](s))
      .toSorted((a, b) =>
        view === "decided"
          ? Temporal.Instant.compare(b.s.updatedAt, a.s.updatedAt)
          : Temporal.Instant.compare(a.s.quote.dueAt, b.s.quote.dueAt),
      )
      .map(({ referral }) => toReferralSummary(referral, settings.authorityProfiles, now));

    return { items, counts, me };
  };
}

export type ListReferrals = ReturnType<typeof makeListReferrals>;

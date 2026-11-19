import type { TenantContext } from "@pas/kernel";
import { clockOf, loadReferral, type UnderwritingDeps } from "./deps";
import {
  type ProducerReferralDto,
  type ReferralDetailDto,
  toProducerReferral,
  toReferralDetail,
} from "./dto";
import { authorityOf, type MyAuthority } from "./list-referrals";

/** One referral for the underwriter, with who can take it and what the viewer may approve. */
export function makeGetReferral(deps: UnderwritingDeps) {
  return {
    async detail(
      ctx: TenantContext,
      input: { id: string },
    ): Promise<{
      referral: ReferralDetailDto;
      me: MyAuthority;
      underwriters: { userId: string; name: string }[];
      history: ReferralDetailDto[];
    }> {
      const now = clockOf(deps, ctx).now();

      const { referral, settings, history } = await deps.uow.run(ctx, async (tx) => {
        const found = await loadReferral(deps, tx, ctx, input.id);
        const all = await deps.referrals.listByQuote(tx, ctx, found.toSnapshot().quoteId);

        return {
          referral: found,
          settings: await deps.settings.get(tx, ctx),
          history: all.filter((r) => r.id !== found.id),
        };
      });

      const profiles = settings.authorityProfiles;
      const staff = await deps.staff.list(ctx);

      return {
        referral: toReferralDetail(referral, profiles, now),
        me: await authorityOf(deps, ctx, profiles),
        underwriters: staff
          .filter((m) =>
            profiles.some(
              (p) => p.userIds.includes(m.userId) || p.roles.some((r) => m.roles.includes(r)),
            ),
          )
          .map((m) => ({ userId: m.userId, name: m.name })),
        history: history.map((r) => toReferralDetail(r, profiles, now)),
      };
    },

    /** The latest referral on a submission's quote, as its producer sees it. */
    async forProducer(
      ctx: TenantContext,
      input: { quoteId: string },
    ): Promise<ProducerReferralDto | null> {
      const referrals = await deps.uow.run(ctx, (tx) =>
        deps.referrals.listByQuote(tx, ctx, input.quoteId),
      );

      const latest = referrals.toSorted((a, b) =>
        Temporal.Instant.compare(b.toSnapshot().openedAt, a.toSnapshot().openedAt),
      )[0];

      return latest ? toProducerReferral(latest) : null;
    },

    /** The open referral for a quote, for the submission page's link into the workbench. */
    async forQuote(ctx: TenantContext, input: { quoteId: string }) {
      const referrals = await deps.uow.run(ctx, (tx) =>
        deps.referrals.listByQuote(tx, ctx, input.quoteId),
      );

      return referrals.map((r) => ({
        id: r.id,
        status: r.status,
        openedAt: r.toSnapshot().openedAt.toString(),
      }));
    },
  };
}

export type GetReferral = ReturnType<typeof makeGetReferral>;

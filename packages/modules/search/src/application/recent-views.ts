import type { ClockProvider, TenantContext, UnitOfWork } from "@pas/kernel";
import type { SearchHit } from "../domain/hit";
import type { RecentType } from "../domain/recent";
import type { SearchScope } from "../domain/scope";
import type { RecentViewRepository } from "../ports/recent-views";
import type { SearchIndex } from "../ports/search-index";

const KEEP = 30;
const SHOWN = 6;

/** Records a user actually opened, across devices; listed through the same scope as search. */
export function makeRecentViews(deps: {
  uow: UnitOfWork;
  index: SearchIndex;
  views: RecentViewRepository;
  clocks: ClockProvider;
}) {
  return {
    async record(ctx: TenantContext, input: { userId: string; type: RecentType; id: string }) {
      const at = deps.clocks.forTenant(ctx.tenantId).now();

      await deps.uow.run(ctx, (tx) => deps.views.record(tx, ctx, { ...input, at }, KEEP));
    },

    async list(
      ctx: TenantContext,
      scope: SearchScope,
      input: { userId: string; types: readonly RecentType[] },
    ): Promise<SearchHit[]> {
      return deps.uow.run(ctx, async (tx) => {
        const views = (await deps.views.list(tx, ctx, input.userId, KEEP)).filter((v) =>
          input.types.includes(v.type),
        );

        const hits: SearchHit[] = [];

        for (const type of input.types) {
          const ids = views.filter((v) => v.type === type).map((v) => v.id);

          if (ids.length === 0) continue;

          hits.push(
            ...(await deps.index.search(
              tx,
              ctx,
              scope,
              { kind: "ids", ids, types: [type] },
              type,
              ids.length,
            )),
          );
        }

        return views
          .flatMap((v) => hits.find((h) => h.type === v.type && h.id === v.id) ?? [])
          .slice(0, SHOWN);
      });
    },
  };
}

export type RecentViews = ReturnType<typeof makeRecentViews>;

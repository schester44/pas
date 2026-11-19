import type { BookScope, TenantContext } from "@pas/kernel";
import { type BookReach, bookScopeFor } from "../domain/book-scope";
import type { DistributionDeps } from "./deps";

/** The one place a caller's book is decided, for submissions, quotes, policies, clients and search. */
export function makeResolveBookScope(
  deps: Pick<DistributionDeps, "uow" | "agencies" | "producers">,
) {
  return async function resolveBookScope(
    ctx: TenantContext,
    input: { userId: string; reach: BookReach },
  ): Promise<BookScope> {
    if (input.reach !== "agency") return bookScopeFor({ ...input, memberships: [], agencies: [] });

    return deps.uow.run(ctx, async (tx) => {
      const [producer, agencies] = await Promise.all([
        deps.producers.findByUser(tx, ctx, input.userId),
        deps.agencies.list(tx, ctx),
      ]);

      return bookScopeFor({ ...input, memberships: producer?.memberships ?? [], agencies });
    });
  };
}

export type ResolveBookScope = ReturnType<typeof makeResolveBookScope>;

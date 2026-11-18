import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SearchHit } from "../domain/hit";
import { classifyQuery, type SearchType } from "../domain/query";
import type { SearchScope } from "../domain/scope";
import type { SearchIndex } from "../ports/search-index";

const PER_TYPE = 5;

export function makeSearch(deps: { uow: UnitOfWork; index: SearchIndex }) {
  return async function search(
    ctx: TenantContext,
    scope: SearchScope,
    input: { q: string; types: readonly SearchType[] },
  ): Promise<SearchHit[]> {
    const query = classifyQuery(input.q);

    if (!query) return [];

    const types = query.types.filter((type) => input.types.includes(type));

    if (types.length === 0) return [];

    return deps.uow.run(ctx, async (tx) => {
      const results: SearchHit[] = [];

      for (const type of types) {
        results.push(...(await deps.index.search(tx, ctx, scope, query, type, PER_TYPE)));
      }

      return results;
    });
  };
}

export type Search = ReturnType<typeof makeSearch>;

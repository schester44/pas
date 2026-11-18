import type { TenantContext, Transaction } from "@pas/kernel";
import type { SearchHit } from "../domain/hit";
import type { SearchQuery, SearchType } from "../domain/query";
import type { SearchScope } from "../domain/scope";

export interface SearchIndex {
  search(
    tx: Transaction,
    ctx: TenantContext,
    scope: SearchScope,
    query: SearchQuery,
    type: SearchType,
    limit: number,
  ): Promise<SearchHit[]>;
}

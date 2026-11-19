import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { RecentType } from "../domain/recent";

export interface RecentViewRepository {
  /** Upserts the view and keeps only the user's latest `keep` records. */
  record(
    tx: Transaction,
    ctx: TenantContext,
    view: { userId: string; type: RecentType; id: string; at: Instant },
    keep: number,
  ): Promise<void>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    userId: string,
    limit: number,
  ): Promise<{ type: RecentType; id: string }[]>;
}

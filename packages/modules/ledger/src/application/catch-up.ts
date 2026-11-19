import type { TenantContext } from "@pas/kernel";
import type { LedgerDeps } from "./deps";
import type { IngestBillingFact } from "./ingest-billing-fact";

/**
 * Re-derives every billing fact from PAS and ingests it again. Posting is keyed exactly as the
 * live path, so facts already in the journal are no-ops and only missed ones post.
 */
export function makeCatchUp(deps: Pick<LedgerDeps, "pas"> & { ingest: IngestBillingFact }) {
  return async function catchUp(ctx: TenantContext): Promise<{ posted: number; failed: number }> {
    let posted = 0;
    let failed = 0;

    for (const fact of await deps.pas.history(ctx)) {
      try {
        if ((await deps.ingest(ctx, fact)).posted) posted++;
      } catch {
        failed++;
      }
    }

    return { posted, failed };
  };
}

export type CatchUp = ReturnType<typeof makeCatchUp>;

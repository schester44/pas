import type { ObligationKind } from "@pas/decisions-engine";
import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { Obligation, ObligationId } from "../domain/obligation";

export type ObligationView = "due" | "overdue" | "rejected" | "done" | "all";

export interface ObligationFilter {
  view?: ObligationView;
  kind?: ObligationKind;
  jurisdiction?: string;
  licenseeId?: string;
  policyId?: string;
  limit?: number;
  now: Instant;
}

export interface FilingBatch {
  id: string;
  providerId: string;
  kind: string;
  jurisdiction: string;
  fileKey: string;
  fileName: string;
  contentType: string;
  checklist: string[];
  obligationIds: string[];
  createdAt: Instant;
}

export interface ObligationRepository {
  findById(tx: Transaction, ctx: TenantContext, id: ObligationId): Promise<Obligation | null>;
  findByDedupeKey(tx: Transaction, ctx: TenantContext, key: string): Promise<Obligation | null>;
  list(tx: Transaction, ctx: TenantContext, filter: ObligationFilter): Promise<Obligation[]>;
  /** Transaction obligations of a kind issued in a period, for one licensee (or the tenant) and state. */
  inPeriod(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      kind: ObligationKind;
      jurisdiction: string;
      licenseeId: string | null;
      from: string;
      to: string;
    },
  ): Promise<Obligation[]>;
  save(tx: Transaction, obligation: Obligation): Promise<void>;
  saveBatch(tx: Transaction, ctx: TenantContext, batch: FilingBatch): Promise<void>;
  findBatch(tx: Transaction, ctx: TenantContext, id: string): Promise<FilingBatch | null>;
  listBatches(tx: Transaction, ctx: TenantContext, limit: number): Promise<FilingBatch[]>;
}

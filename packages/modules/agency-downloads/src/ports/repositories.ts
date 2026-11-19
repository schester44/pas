import type { TenantContext, Transaction } from "@pas/kernel";
import type { Enrollment } from "../domain/enrollment";
import type { DownloadBatch, DownloadItem, ItemStatus } from "../domain/item";

export interface EnrollmentRepository {
  list(tx: Transaction, ctx: TenantContext): Promise<Enrollment[]>;
  findByAgency(tx: Transaction, ctx: TenantContext, agencyId: string): Promise<Enrollment | null>;
  save(tx: Transaction, enrollment: Enrollment): Promise<void>;
}

export interface ItemRepository {
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<DownloadItem | null>;
  findByDedupeKey(tx: Transaction, ctx: TenantContext, key: string): Promise<DownloadItem | null>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: {
      status?: ItemStatus;
      agencyId?: string;
      batchId?: string;
      policyId?: string;
      ids?: readonly string[];
      limit?: number;
    },
  ): Promise<DownloadItem[]>;
  save(tx: Transaction, item: DownloadItem): Promise<void>;
}

export interface BatchRepository {
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<DownloadBatch | null>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyId?: string; runKeyPrefix?: string; limit?: number },
  ): Promise<DownloadBatch[]>;
  save(tx: Transaction, batch: DownloadBatch): Promise<void>;
}

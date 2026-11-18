import type { TenantContext, Transaction } from "@pas/kernel";
import type { RaterWorkbook, RaterWorkbookId } from "../domain/rater-workbook";

export interface RaterWorkbookRepository {
  insert(tx: Transaction, workbook: RaterWorkbook): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: RaterWorkbookId): Promise<RaterWorkbook | null>;
  findBySha256(tx: Transaction, ctx: TenantContext, sha256: string): Promise<RaterWorkbook | null>;
  list(tx: Transaction, ctx: TenantContext): Promise<RaterWorkbook[]>;
}

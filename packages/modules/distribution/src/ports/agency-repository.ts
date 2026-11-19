import type { TenantContext, Transaction } from "@pas/kernel";
import type { Agency } from "../domain/agency";

export interface AgencyRepository {
  list(tx: Transaction, ctx: TenantContext): Promise<Agency[]>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Agency | null>;
  save(tx: Transaction, agency: Agency): Promise<void>;
}

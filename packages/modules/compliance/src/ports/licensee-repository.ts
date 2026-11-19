import type { TenantContext, Transaction } from "@pas/kernel";
import type { Licensee } from "../domain/licensee";

export interface LicenseeRepository {
  list(tx: Transaction, ctx: TenantContext): Promise<Licensee[]>;
  save(tx: Transaction, licensee: Licensee): Promise<void>;
  remove(tx: Transaction, ctx: TenantContext, id: string): Promise<void>;
}

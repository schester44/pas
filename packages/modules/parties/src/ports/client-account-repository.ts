import type { TenantContext, Transaction } from "@pas/kernel";
import type { ClientAccount, ClientAccountId } from "../domain/client-account";
import type { ContactKeys } from "../domain/contact";

export interface ClientAccountRepository {
  save(tx: Transaction, account: ClientAccount): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: ClientAccountId): Promise<ClientAccount | null>;
  findByIds(tx: Transaction, ctx: TenantContext, ids: readonly string[]): Promise<ClientAccount[]>;
  /** Active accounts sharing any key with `keys`, oldest first. */
  findCandidates(tx: Transaction, ctx: TenantContext, keys: ContactKeys): Promise<ClientAccount[]>;
  findByEmailKey(tx: Transaction, ctx: TenantContext, key: string): Promise<ClientAccount[]>;
  search(
    tx: Transaction,
    ctx: TenantContext,
    options: { query: string; limit: number },
  ): Promise<ClientAccount[]>;
}

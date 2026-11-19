import type { TenantContext, Transaction } from "@pas/kernel";
import type { AddressRecord } from "../domain/address-record";

export interface AddressRepository {
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<AddressRecord | null>;
  findByIds(tx: Transaction, ctx: TenantContext, ids: readonly string[]): Promise<AddressRecord[]>;
  findByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<AddressRecord | null>;
  findByTextKeys(
    tx: Transaction,
    ctx: TenantContext,
    keys: readonly string[],
  ): Promise<AddressRecord[]>;
  /** Inserts or updates; a concurrent insert of the same key returns the record that won. */
  save(tx: Transaction, ctx: TenantContext, record: AddressRecord): Promise<AddressRecord>;
}

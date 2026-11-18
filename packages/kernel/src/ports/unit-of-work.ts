import type { DomainEvent } from "../events";
import type { TenantContext } from "../tenant";

/** Opaque transaction handle. Adapters cast it to their own client type. */
export interface Transaction {
  readonly __transaction: unique symbol;
}

/**
 * Runs work atomically for one tenant. Implementations scope the transaction to the tenant
 * (e.g. Postgres RLS) and persist `events` to the outbox in the same transaction.
 */
export interface UnitOfWork {
  run<T>(ctx: TenantContext, work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** Writes domain events in the caller's transaction; a relay publishes them later. */
export interface Outbox {
  add(tx: Transaction, events: readonly DomainEvent[]): Promise<void>;
}

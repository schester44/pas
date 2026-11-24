import type { TenantContext, Transaction } from "@pas/kernel";
import type { ClientRequest, ClientRequestId } from "../domain/client-request";

export interface ClientRequestRepository {
  save(tx: Transaction, request: ClientRequest): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: ClientRequestId): Promise<ClientRequest | null>;
  /** The quote's most recent request, whatever its status. */
  findLatestByQuote(
    tx: Transaction,
    ctx: TenantContext,
    quoteId: string,
  ): Promise<ClientRequest | null>;
}

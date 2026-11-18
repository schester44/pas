import type { Instant, TenantContext, Transaction } from "@pas/kernel";

export type ClientUserMethod = "email" | "self_claim";

export interface ClientUserLink {
  userId: string;
  clientAccountId: string;
  method: ClientUserMethod;
  verifiedAt: Instant;
}

/** Portal users per tenant, and the self-claim attempts that rate-limit them. */
export interface ClientUserRepository {
  link(tx: Transaction, ctx: TenantContext, link: ClientUserLink): Promise<void>;
  listForUser(tx: Transaction, ctx: TenantContext, userId: string): Promise<ClientUserLink[]>;
  listForAccounts(
    tx: Transaction,
    ctx: TenantContext,
    accountIds: readonly string[],
  ): Promise<ClientUserLink[]>;
  moveAccount(tx: Transaction, ctx: TenantContext, from: string, to: string): Promise<void>;
  recordClaimAttempt(
    tx: Transaction,
    ctx: TenantContext,
    attempt: { userId: string; policyNumber: string; succeeded: boolean; attemptedAt: Instant },
  ): Promise<void>;
  countFailedClaims(
    tx: Transaction,
    ctx: TenantContext,
    userId: string,
    since: Instant,
  ): Promise<number>;
}

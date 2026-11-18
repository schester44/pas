import type { TenantContext, Transaction } from "@pas/kernel";
import type { PartyRole } from "../domain/client-scope";

export interface PolicyPartyLink {
  policyId: string;
  policyNumber: string;
  clientAccountId: string;
  role: PartyRole;
}

export interface PolicyPartyRepository {
  /** Idempotent on (policy, account, role). */
  link(tx: Transaction, ctx: TenantContext, link: PolicyPartyLink): Promise<void>;
  listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string): Promise<PolicyPartyLink[]>;
  listByAccounts(
    tx: Transaction,
    ctx: TenantContext,
    accountIds: readonly string[],
  ): Promise<PolicyPartyLink[]>;
  findByPolicyNumber(
    tx: Transaction,
    ctx: TenantContext,
    policyNumber: string,
  ): Promise<PolicyPartyLink[]>;
  moveAccount(tx: Transaction, ctx: TenantContext, from: string, to: string): Promise<void>;
}

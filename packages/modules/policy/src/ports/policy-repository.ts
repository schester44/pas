import type { TenantContext, Transaction } from "@pas/kernel";
import type { Policy, PolicyId, PolicyTermId } from "../domain/policy";
import type { PolicyEventProps } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";

export interface PolicyRepository {
  /** Inserts what the aggregate added and updates its terms; issued rows are never rewritten. */
  save(tx: Transaction, policy: Policy): Promise<void>;
  findById(
    tx: Transaction,
    ctx: TenantContext,
    scope: PolicyScope,
    id: PolicyId,
  ): Promise<Policy | null>;
  findByQuote(tx: Transaction, ctx: TenantContext, quoteId: string): Promise<Policy | null>;
  findByTerm(tx: Transaction, ctx: TenantContext, termId: PolicyTermId): Promise<Policy | null>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    scope: PolicyScope,
    options: { limit: number },
  ): Promise<Policy[]>;
  appendEvent(
    tx: Transaction,
    ctx: TenantContext,
    policyId: PolicyId,
    event: PolicyEventProps,
  ): Promise<void>;
  /** Next value of the tenant's gap-tolerant policy counter, starting at 1. */
  nextSequence(tx: Transaction, ctx: TenantContext): Promise<number>;
}

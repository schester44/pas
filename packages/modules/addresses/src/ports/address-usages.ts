import type { TenantContext, Transaction } from "@pas/kernel";
import type { AddressUsage, SubjectRef, UsageRole } from "../domain/clearance";

export interface AddressUsages {
  /** Replaces a subject's usages for the given roles with `usages`. */
  replace(
    tx: Transaction,
    ctx: TenantContext,
    subject: SubjectRef,
    roles: readonly UsageRole[],
    usages: readonly AddressUsage[],
  ): Promise<void>;
  setActive(
    tx: Transaction,
    ctx: TenantContext,
    subject: SubjectRef,
    active: boolean,
  ): Promise<void>;
  listBySubject(tx: Transaction, ctx: TenantContext, subject: SubjectRef): Promise<AddressUsage[]>;
  listActiveByAddresses(
    tx: Transaction,
    ctx: TenantContext,
    addressIds: readonly string[],
  ): Promise<AddressUsage[]>;
}

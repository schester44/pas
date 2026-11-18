import type { TenantContext, Transaction } from "@pas/kernel";
import type { OrganizationRef, TenantProfile } from "../domain/tenant-profile";

export interface TenantProfileRepository {
  find(tx: Transaction, ctx: TenantContext): Promise<TenantProfile | null>;
  organization(tx: Transaction, ctx: TenantContext): Promise<OrganizationRef>;
  save(tx: Transaction, profile: TenantProfile): Promise<void>;
}

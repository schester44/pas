import type { Instant, TenantContext, TenantId, Transaction } from "@pas/kernel";
import type { OrganizationRef } from "../domain/tenant-profile";
import type { TenantEnvironment } from "../domain/tenant-environment";

export interface FiredTimer {
  dueAt: string;
  workflowId: string;
  label: string;
  reference: string | null;
  outcome: string;
}

export interface TimeAdvance {
  id: string;
  from: Instant;
  to: Instant;
  actor: unknown;
  fired: FiredTimer[];
  createdAt: Instant;
}

export interface TenantEnvironmentRepository {
  /** Null for a production tenant, which has no environment row. */
  find(tx: Transaction, ctx: TenantContext): Promise<TenantEnvironment | null>;
  save(tx: Transaction, environment: TenantEnvironment): Promise<void>;
  sandboxes(tx: Transaction, ctx: TenantContext): Promise<OrganizationRef[]>;
  organization(tx: Transaction, tenantId: TenantId): Promise<OrganizationRef | null>;
  recordAdvance(tx: Transaction, ctx: TenantContext, advance: TimeAdvance): Promise<void>;
  advances(tx: Transaction, ctx: TenantContext, limit: number): Promise<TimeAdvance[]>;
}

import type { Clock, ClockProvider, IdRemap, Instant, TenantContext, TenantId } from "@pas/kernel";
import type { OrganizationRef } from "../domain/tenant-profile";

export interface SandboxOrganizations {
  /** Creates the sandbox organization and gives the parent's admins membership. */
  create(parent: TenantContext, name: string): Promise<OrganizationRef>;
}

/** Copies one bounded context's configuration into a sandbox, returning counts per kind. */
export interface SandboxSeed {
  copy(from: TenantContext, to: TenantContext, ids: IdRemap): Promise<Record<string, number>>;
}

export interface UpcomingTimer {
  runId: string;
  workflowId: string;
  stepId: string;
  dueAt: Instant;
  label: string;
  reference: string | null;
}

/** Durable timers of one tenant, in that tenant's time. */
export interface SandboxTimers {
  upcoming(
    ctx: TenantContext,
    options: { until?: Instant; limit?: number },
  ): Promise<UpcomingTimer[]>;
  /** Wakes timers due at the tenant's current time and re-arms the rest. */
  release(ctx: TenantContext): Promise<void>;
  /** Resolves once the tenant's woken runs have finished their work. */
  settle(ctx: TenantContext): Promise<void>;
  outcome(ctx: TenantContext, runId: string): Promise<string>;
}

export interface TenantClockControl extends ClockProvider {
  readonly wall: Clock;
  refresh(tenantId: TenantId): Promise<void>;
}

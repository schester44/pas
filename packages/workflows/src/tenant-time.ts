/** Resolves a tenant's time-travel offset; production tenants are always 0. */
export interface TenantTime {
  offsetMs(tenantId: string): Promise<number>;
}

export const realTime: TenantTime = { offsetMs: async () => 0 };

/**
 * Wake times are stored in tenant time. A timer fires when wall-clock time plus the tenant's
 * current offset reaches it, so a larger offset pulls the wall-clock fire time earlier.
 */
export function timerPlan(
  tenantWakeAt: Date,
  offsetMs: number,
  wallNow: Date,
): { due: boolean; startAfter: Date } {
  const startAfter = new Date(tenantWakeAt.getTime() - offsetMs);

  return { due: startAfter.getTime() <= wallNow.getTime(), startAfter };
}

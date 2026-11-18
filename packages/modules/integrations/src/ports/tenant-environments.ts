import type { TenantId } from "@pas/kernel";

export interface TenantEnvironments {
  isSandbox(tenantId: TenantId): Promise<boolean>;
}

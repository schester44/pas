import type { TenantContext, TenantId, Transaction } from "@pas/kernel";
import type { IntegrationInstall } from "../domain/install";

export interface InstallRepository {
  list(tx: Transaction, ctx: TenantContext): Promise<IntegrationInstall[]>;
  find(tx: Transaction, ctx: TenantContext, providerId: string): Promise<IntegrationInstall | null>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<IntegrationInstall | null>;
  save(tx: Transaction, install: IntegrationInstall): Promise<void>;
  /** Platform-level: webhooks arrive without a tenant, so find the install's tenant first. */
  tenantOf(installId: string): Promise<TenantId | null>;
}

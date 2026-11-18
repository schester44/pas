import type { TenantContext, Transaction } from "@pas/kernel";
import type { ChangeRequestProps } from "../domain/change-request";

export interface ChangeRequestRepository {
  add(tx: Transaction, ctx: TenantContext, request: ChangeRequestProps): Promise<void>;
  listByPolicy(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
  ): Promise<ChangeRequestProps[]>;
}

import type { InspectionType } from "@pas/decisions-engine";
import type { Instant, ProviderFor, TenantContext } from "@pas/kernel";
import type { InspectionAddress, InspectionUpdate } from "../domain/inspection";

export interface InspectionOrder {
  reference: string;
  type: InspectionType;
  address: InspectionAddress;
  policyNumber: string | null;
  insuredName: string | null;
}

export interface InspectionStatusReport extends InspectionUpdate {
  /** When the vendor expects the next change; polling waits until then. */
  nextCheckAt?: Instant;
}

/** The inspection vendor port (PLAN §11, docs/research/vendors.md §2). */
export interface InspectionProvider {
  readonly provider: string;
  order(
    ctx: TenantContext,
    order: InspectionOrder,
  ): Promise<{ providerRef: string } & InspectionStatusReport>;
  check(ctx: TenantContext, providerRef: string): Promise<InspectionStatusReport>;
}

export type InspectionProviders = ProviderFor<InspectionProvider>;

import type { CanonicalInput, Capability, FlowSubject } from "@pas/carriers";
import type { TenantContext } from "@pas/kernel";

/** Carrier-owned policy changes (PLAN §12): start the carrier's flow, read the policy's link. */
export interface CarrierTransactions {
  start(
    ctx: TenantContext,
    input: {
      carrier: string;
      capability: Capability;
      subject: FlowSubject;
      input: CanonicalInput;
      idempotencyKey: string;
    },
  ): Promise<{ flowRunId: string }>;
  carrierName(ctx: TenantContext, carrier: string): Promise<string>;
  link(
    ctx: TenantContext,
    policyId: string,
  ): Promise<{ carrierPolicyNumber: string | null; carrierReference: string | null } | null>;
}

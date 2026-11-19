import type {
  CanonicalInput,
  Capability,
  CarrierDocumentRef,
  FetchedDocument,
  FlowSubject,
} from "@pas/carriers";
import type { TenantContext } from "@pas/kernel";

/** The carrier side of a quote and a carrier-owned bind (PLAN §12), however it is connected. */
export interface CarrierGateway {
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
  documents(
    ctx: TenantContext,
    input: { flowRunId: string; documents: readonly CarrierDocumentRef[] },
  ): Promise<FetchedDocument[]>;
  linkPolicy(
    ctx: TenantContext,
    input: {
      carrier: string;
      policyId: string;
      quoteId: string;
      carrierPolicyNumber: string | null;
      carrierReference: string | null;
    },
  ): Promise<void>;
  mergePdfs(parts: readonly Uint8Array[]): Promise<Uint8Array>;
}

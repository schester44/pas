import type { ChannelKind, ObligationKind } from "@pas/decisions-engine";
import type { TenantContext } from "@pas/kernel";

export interface MoneyJson {
  amount: string;
  currency: string;
}

/** Everything a channel needs to file one obligation, independent of the policy model. */
export interface FilingRequest {
  obligationId: string;
  attempt: number;
  kind: ObligationKind;
  code: string;
  title: string;
  jurisdiction: string;
  policyNumber: string | null;
  transactionType: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  issuedDate: string | null;
  insuredName: string | null;
  premium: MoneyJson | null;
  taxesFees: { code: string; label: string; amount: MoneyJson }[];
  licensee: { name: string; licenseNumber: string; jurisdiction: string } | null;
  period: { start: string; end: string } | null;
  correction: string | null;
  data: Record<string, unknown>;
}

export type FilingResult =
  | { status: "submitted"; reference: string }
  | { status: "accepted"; reference: string; filingNumber: string; stampNumber?: string }
  | { status: "rejected"; reference: string | null; reasons: string[] };

export type FilingOutcome =
  | { status: "pending" }
  | { status: "accepted"; filingNumber: string; stampNumber?: string }
  | { status: "rejected"; reasons: string[] };

export interface ExportedBatch {
  fileName: string;
  contentType: string;
  body: Uint8Array;
  checklist: string[];
}

export type ChannelDelivery = "api" | "file_export";

/**
 * How an obligation is delivered (PLAN §17.5). A channel declares the obligation kinds and
 * jurisdictions it serves; API channels submit and answer later, file channels export batches.
 */
export interface FilingChannel {
  readonly provider: string;
  readonly name: string;
  readonly delivery: ChannelDelivery;
  readonly pollAfterSeconds?: number;
  serves(kind: ObligationKind, jurisdiction: string): boolean;
  submit?(ctx: TenantContext, request: FilingRequest): Promise<FilingResult>;
  poll?(
    ctx: TenantContext,
    input: { reference: string; request: FilingRequest; submittedAt: string },
  ): Promise<FilingOutcome>;
  exportBatch?(
    ctx: TenantContext,
    input: { batchId: string; requests: FilingRequest[] },
  ): Promise<ExportedBatch>;
}

/** The tenant's enabled channels, resolved at call time from its integrations. */
export interface FilingChannels {
  serving(
    ctx: TenantContext,
    input: { kind: ObligationKind; jurisdiction: string; preferred: ChannelKind },
  ): Promise<FilingChannel[]>;
  byProvider(ctx: TenantContext, providerId: string): Promise<FilingChannel | null>;
}

import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { MailType } from "./adapters";

export type MailReference =
  | { kind: "policy_notice"; policyId: string; transactionId: string; title: string }
  | { kind: "other"; label: string };

export interface TrackingEntry {
  status: string;
  occurredAt: string;
  externalId: string;
}

export interface MailProof {
  providerId: string;
  providerRef: string;
  mailType: MailType;
  trackingNumber: string | null;
  mailedAt: string;
  eventId: string;
}

export interface MailPieceRecord {
  id: string;
  installId: string | null;
  providerId: string;
  providerRef: string;
  reference: MailReference;
  mailType: MailType;
  status: string;
  trackingNumber: string | null;
  tracking: TrackingEntry[];
  proof: MailProof | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface MailPieces {
  find(
    tx: Transaction,
    ctx: TenantContext,
    providerId: string,
    providerRef: string,
  ): Promise<MailPieceRecord | null>;
  save(tx: Transaction, ctx: TenantContext, piece: MailPieceRecord): Promise<void>;
}

/** Records proof of mailing on the notice it belongs to (the policy timeline, PLAN §17.3). */
export interface NoticeProofs {
  record(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      summary: string;
      data: { transactionId: string; proofOfMailing: MailProof };
    },
  ): Promise<void>;
}

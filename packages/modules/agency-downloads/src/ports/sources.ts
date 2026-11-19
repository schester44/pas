import type { TenantContext } from "@pas/kernel";
import type { DownloadTransactionView } from "../domain/record";
import type { CommissionStatementRecord } from "../domain/statement";

/** Policy administration and the catalog, seen from agency downloads. */
export interface TransactionSource {
  /** Null for transactions that aren't issued or have no agency. */
  view(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<DownloadTransactionView | null>;
  document(
    ctx: TenantContext,
    input: { policyId: string; documentId: string },
  ): Promise<{ fileName: string; body: Uint8Array }>;
  linesOfBusiness(ctx: TenantContext): Promise<string[]>;
}

/** Distribution: agency names and commission statements. */
export interface AgencySource {
  agencies(ctx: TenantContext): Promise<{ id: string; name: string; status: string }[]>;
  statement(
    ctx: TenantContext,
    input: { agencyId: string; from: string; to: string },
  ): Promise<Omit<CommissionStatementRecord, "agency" | "version"> & { agencyName: string }>;
}

/** Compliance: each download is an `ams_download` obligation, met when the file is delivered. */
export interface DownloadObligations {
  open(
    ctx: TenantContext,
    input: {
      dedupeKey: string;
      title: string;
      jurisdiction: { country: string; subdivision?: string };
      policy: { id: string; number: string; termId: string | null } | null;
      transaction: { id: string; type: string } | null;
      dueDate: string;
      data: Record<string, unknown>;
    },
  ): Promise<{ obligationId: string }>;
  settle(
    ctx: TenantContext,
    input: { dedupeKey: string; providerId: string; reference: string },
  ): Promise<void>;
}

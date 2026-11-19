import type { TenantContext } from "@pas/kernel";
import type { DownloadSettings } from "../domain/settings";

export interface DeliveryFile {
  fileId: string;
  accountCode: string;
  mailbox: string | null;
  fileName: string;
  contentType: string;
  body: Uint8Array;
  itemCount: number;
}

/** The tenant's enabled agency downloads provider: its settings and its transport. */
export interface AgencyDownloadChannel {
  readonly provider: string;
  readonly name: string;
  readonly transport: "test_mailbox" | "ivans";
  readonly test: boolean;
  readonly settings: DownloadSettings;
  deliver(ctx: TenantContext, file: DeliveryFile): Promise<{ reference: string }>;
}

/** Null when the tenant hasn't enabled agency downloads: then nothing is produced. */
export interface AgencyDownloadChannels {
  active(ctx: TenantContext): Promise<AgencyDownloadChannel | null>;
}

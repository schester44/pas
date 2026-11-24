import type { Id, Instant, TenantId } from "@pas/kernel";
import type { ExtensionId } from "./extension";
import type { ExtensionManifest } from "./manifest";
import type { ExtensionTest, TestReport } from "./test-case";

export type ExtensionVersionId = Id<"ExtensionVersion">;

/** Immutable once published; product releases and subscriptions pin it by id. */
export interface ExtensionVersion {
  id: ExtensionVersionId;
  tenantId: TenantId;
  extensionId: ExtensionId;
  version: number;
  code: string;
  source: Record<string, string>;
  manifest: ExtensionManifest;
  tests: ExtensionTest[];
  contentHash: string;
  testReport: TestReport;
  note: string | null;
  publishedAt: Instant;
}

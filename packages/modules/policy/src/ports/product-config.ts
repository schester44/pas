import type { ExtensionBinding } from "@pas/extension-points";
import type { JdmDecision } from "@pas/decisions-engine";
import type { DocumentSet } from "@pas/documents";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction, TenantContext } from "@pas/kernel";

export interface PolicyReleaseDecision {
  kind: string;
  key: string;
  name: string;
  decision: JdmDecision;
}

export interface PolicyRelease {
  id: string;
  productId: string;
  version: string;
  jurisdiction: Jurisdiction;
  riskSchema: RiskSchema;
  forms: { channel: string; stage: string; form: FormDefinition }[];
  rules: PolicyReleaseDecision[];
  documents: DocumentSet;
  lifecycle: Record<string, unknown>;
  extensions: ExtensionBinding[];
}

/** The catalog, seen from policy administration. Releases are immutable. */
export interface PolicyProductConfig {
  release(ctx: TenantContext, id: string): Promise<PolicyRelease>;
  /** Newest published releases of the product in the jurisdiction, newest first. */
  publishedReleases(
    ctx: TenantContext,
    input: { productId: string; jurisdiction: Jurisdiction },
  ): Promise<PolicyRelease[]>;
}

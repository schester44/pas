import type { DecisionKind, JdmDecision } from "@pas/decisions-engine";
import type { DocumentSet } from "@pas/documents";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction, TenantContext } from "@pas/kernel";
import type { RatingConfig } from "@pas/rating-engine";
import type { CoverageDefinition } from "../domain/coverages";

export interface ReleaseForm {
  channel: string;
  stage: string;
  form: FormDefinition;
}

export interface ReleaseDecision {
  kind: DecisionKind;
  key: string;
  name: string;
  decision: JdmDecision;
}

export interface CatalogRelease {
  id: string;
  productId: string;
  productVersionId: string;
  version: string;
  jurisdiction: Jurisdiction;
  riskSchema: RiskSchema;
  forms: ReleaseForm[];
  coverages: CoverageDefinition[];
  rules: ReleaseDecision[];
  rating: RatingConfig | null;
  documents: DocumentSet;
  lifecycle: Record<string, unknown>;
}

/** The submissions context's view of the catalog. Never call it inside a unit of work. */
export interface ProductCatalog {
  resolveNewBusiness(
    ctx: TenantContext,
    input: { productId: string; jurisdiction: Jurisdiction; effectiveDate: string },
  ): Promise<CatalogRelease | null>;
  getRelease(ctx: TenantContext, id: string): Promise<CatalogRelease>;
  productName(ctx: TenantContext, productId: string): Promise<string>;
  productNames(ctx: TenantContext): Promise<Map<string, string>>;
}

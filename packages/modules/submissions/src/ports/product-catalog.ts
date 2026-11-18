import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction, TenantContext } from "@pas/kernel";

export interface ReleaseForm {
  channel: string;
  stage: string;
  form: FormDefinition;
}

export interface CatalogRelease {
  id: string;
  productId: string;
  productVersionId: string;
  version: string;
  riskSchema: RiskSchema;
  forms: ReleaseForm[];
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

import type { TenantContext } from "@pas/kernel";

/** Which form editions exist in the tenant's forms library (owned by the documents context). */
export interface FormEditionDirectory {
  existing(ctx: TenantContext, ids: readonly string[]): Promise<ReadonlySet<string>>;
}

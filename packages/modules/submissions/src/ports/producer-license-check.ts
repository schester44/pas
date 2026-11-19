import type { Jurisdiction, TenantContext } from "@pas/kernel";

/** Distribution, seen from bind (PLAN §11): may this producer bind this product here and now? */
export interface ProducerLicenseCheck {
  check(
    ctx: TenantContext,
    input: {
      producerId: string;
      productId: string;
      jurisdiction: Jurisdiction;
      effectiveDate: string;
    },
  ): Promise<{ blocks: boolean; message: string | null }>;
}

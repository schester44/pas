import type { TenantContext } from "@pas/kernel";

/** Pre-bind subjectivities still open on a quote, owned by underwriting (PLAN §7.2). */
export interface BindConditions {
  outstanding(
    ctx: TenantContext,
    input: { quoteId: string; submissionId: string },
  ): Promise<{ title: string }[]>;
}

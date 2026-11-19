import type { TenantContext } from "@pas/kernel";

/** Checks the carrier a version names can do what its ownership needs (owned by carriers). */
export interface CarrierVerifier {
  verify(
    ctx: TenantContext,
    lifecycle: Record<string, unknown>,
  ): Promise<{ severity: "error" | "warning"; message: string }[]>;
}

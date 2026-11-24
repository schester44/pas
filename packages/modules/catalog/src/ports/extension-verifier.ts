import type { ExtensionPoint } from "@pas/extension-points";
import type { TenantContext } from "@pas/kernel";

/** Checks that bound extension versions exist and implement their points (owned by extensions). */
export interface ExtensionVerifier {
  verify(
    ctx: TenantContext,
    references: readonly {
      bindingId?: string;
      point: ExtensionPoint;
      extensionVersionId: string;
    }[],
  ): Promise<{ bindingId?: string; severity: "error" | "warning"; message: string }[]>;
}

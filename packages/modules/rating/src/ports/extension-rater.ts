import type { PointOutputs } from "@pas/extension-points";
import type { TenantContext } from "@pas/kernel";
import type { RatingInput } from "@pas/rating-engine";
import type { ExtensionRaterSource } from "../domain/extension-rating";

/** Runs an extension's `rate` export in the sandbox (owned by the extensions context). */
export interface ExtensionRaterRunner {
  rate(
    ctx: TenantContext,
    source: ExtensionRaterSource,
    input: RatingInput,
  ): Promise<PointOutputs["rate"]>;
}

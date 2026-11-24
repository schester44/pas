import {
  type BindingInvoker,
  failurePolicyOf,
  POINT_SPECS,
  timeoutOf,
} from "@pas/extension-points";
import { DomainError } from "@pas/kernel";
import type { RunExtension } from "./run-extension";

/**
 * The BindingInvoker other contexts get: runs a bound version and applies the binding's
 * failure policy. A blocked failure surfaces as a DomainError naming the run to look at.
 */
export function makeBindingInvoker(runExtension: RunExtension): BindingInvoker {
  return {
    async invoke(ctx, binding, input, subject) {
      const policy = failurePolicyOf(binding);

      try {
        const result = await runExtension(ctx, {
          extensionVersionId: binding.extensionVersionId,
          point: binding.point,
          input,
          timeoutMs: timeoutOf(binding),
          ...(subject && { subject }),
        });

        if (result.ok) return result.output;

        if (policy === "skip") return null;

        throw new DomainError(
          "precondition_failed",
          `${POINT_SPECS[binding.point].label} extension failed: ${result.error.message}`,
          {
            reason: "extension_failed",
            code: result.error.code,
            runId: result.run.id,
            bindingId: binding.id,
          },
        );
      } catch (error) {
        if (policy === "skip") return null;

        throw error;
      }
    },
  };
}

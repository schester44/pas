import { DomainError, type TenantContext } from "@pas/kernel";
import { type ExtensionBinding, failurePolicyOf } from "./binding";
import type { PointOutputs } from "./outputs";
import type { ExtensionPoint } from "./points";

/** What a run is about, so runs can be listed on the record that caused them. */
export interface RunSubject {
  type: string;
  id: string;
}

/**
 * How a context runs the extensions bound at a point. A failed run under a `block` policy
 * throws a DomainError; under `skip` it resolves to `null` and the context carries on.
 */
export interface BindingInvoker {
  invoke<P extends ExtensionPoint>(
    ctx: TenantContext,
    binding: ExtensionBinding & { point: P },
    input: unknown,
    subject?: RunSubject,
  ): Promise<PointOutputs[P] | null>;
}

/** For processes composed without the sandbox: skippable bindings are skipped, the rest refuse. */
export const noExtensions: BindingInvoker = {
  invoke: async (_ctx, binding) => {
    if (failurePolicyOf(binding) === "skip") return null;

    throw new DomainError("precondition_failed", "Extensions can't run here", {
      reason: "extensions_unavailable",
      bindingId: binding.id,
    });
  },
};

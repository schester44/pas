import { DomainError, type TenantContext } from "@pas/kernel";
import { bindingsAt, type ExtensionBinding, failurePolicyOf } from "./binding";
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

/** `precommit` bindings in order, each given the risk the previous one returned. */
export async function prepareWith(
  invoker: BindingInvoker,
  ctx: TenantContext,
  bindings: readonly ExtensionBinding[] | undefined,
  input: Record<string, unknown> & { risk: Record<string, unknown> },
  subject?: RunSubject,
): Promise<Record<string, unknown>> {
  let risk = input.risk;

  for (const binding of bindingsAt(bindings, "precommit")) {
    const output = await invoker.invoke(ctx, binding, { ...input, risk }, subject);

    if (output) risk = output.risk;
  }

  return risk;
}

/** `validate` bindings' errors keyed by field path, the shape form validation returns. */
export async function validateWith(
  invoker: BindingInvoker,
  ctx: TenantContext,
  bindings: readonly ExtensionBinding[] | undefined,
  input: Record<string, unknown>,
  subject?: RunSubject,
): Promise<Record<string, string[]>> {
  const outputs = await Promise.all(
    bindingsAt(bindings, "validate").map((binding) => invoker.invoke(ctx, binding, input, subject)),
  );

  const errors: Record<string, string[]> = {};

  for (const issue of outputs.flatMap((output) => output?.issues ?? [])) {
    if (issue.severity !== "error") continue;

    const path = issue.path ?? "";

    errors[path] = [...(errors[path] ?? []), issue.message];
  }

  return errors;
}

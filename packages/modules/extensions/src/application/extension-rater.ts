import type { BindingInvoker, PointOutputs } from "@pas/extension-points";
import { DomainError, type TenantContext } from "@pas/kernel";

/** The rating context's extension runner: `rate` always fails closed, so a null never comes back. */
export function makeExtensionRater(invoker: BindingInvoker) {
  return {
    async rate(
      ctx: TenantContext,
      source: { extensionVersionId: string; timeoutMs?: number },
      input: unknown,
    ): Promise<PointOutputs["rate"]> {
      const output = await invoker.invoke(
        ctx,
        {
          id: "rating",
          point: "rate",
          extensionVersionId: source.extensionVersionId,
          ...(source.timeoutMs !== undefined && { timeoutMs: source.timeoutMs }),
        },
        input,
      );

      if (!output)
        throw new DomainError("precondition_failed", "The extension rater returned nothing");

      return output;
    },
  };
}

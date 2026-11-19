import { asId, type ClockProvider, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { BillingMethod } from "../domain/policy";
import type { PolicyRepository } from "../ports/policy-repository";

/** Keeps the term's billing method in step with billing (PLAN §13). Idempotent. */
export function makeChangeBillingMethod(deps: {
  uow: UnitOfWork;
  policies: PolicyRepository;
  clocks: ClockProvider;
}) {
  return async function changeBillingMethod(
    ctx: TenantContext,
    input: { policyId: string; termId: string; billingMethod: BillingMethod },
  ): Promise<void> {
    await deps.uow.run(ctx, async (tx) => {
      const policy = await deps.policies.findById(
        tx,
        ctx,
        { kind: "tenant" },
        asId(input.policyId),
      );

      if (
        !policy?.changeBillingMethod(
          input.termId,
          input.billingMethod,
          deps.clocks.forTenant(ctx.tenantId),
        )
      ) {
        return;
      }

      await deps.policies.save(tx, policy);
    });
  };
}

export type ChangeBillingMethod = ReturnType<typeof makeChangeBillingMethod>;

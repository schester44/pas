import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { PolicyScope } from "../domain/scope";
import type { PolicyRepository } from "../ports/policy-repository";
import { type PolicySummaryDto, toPolicySummaryDto } from "./dto";

export function makeListPolicies(deps: { uow: UnitOfWork; policies: PolicyRepository }) {
  return async function listPolicies(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { limit?: number } = {},
  ): Promise<PolicySummaryDto[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const policies = await deps.uow.run(ctx, (tx) => deps.policies.list(tx, ctx, scope, { limit }));

    return policies.map(toPolicySummaryDto);
  };
}

export type ListPolicies = ReturnType<typeof makeListPolicies>;

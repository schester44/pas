import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { PolicyScope } from "../domain/scope";
import type { ChangeRequestRepository } from "../ports/change-request-repository";
import type { PolicyRepository } from "../ports/policy-repository";

export interface ChangeRequestDto {
  id: string;
  kind: string;
  details: string;
  status: string;
  requestedBy: { name: string; email: string };
  createdAt: string;
}

export function makeListChangeRequests(deps: {
  uow: UnitOfWork;
  policies: PolicyRepository;
  changeRequests: ChangeRequestRepository;
}) {
  return async function listChangeRequests(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string },
  ): Promise<ChangeRequestDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const policy = await deps.policies.findById(tx, ctx, scope, asId(input.policyId));

      if (!policy) throw notFound("Policy", input.policyId);

      const requests = await deps.changeRequests.listByPolicy(tx, ctx, policy.id);

      return requests.map((r) => ({
        id: r.id,
        kind: r.kind,
        details: r.details,
        status: r.status,
        requestedBy: { name: r.requestedBy.name, email: r.requestedBy.email },
        createdAt: r.createdAt.toString(),
      }));
    });
  };
}

export type ListChangeRequests = ReturnType<typeof makeListChangeRequests>;

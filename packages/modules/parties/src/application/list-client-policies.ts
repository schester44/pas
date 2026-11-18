import type { TenantContext } from "@pas/kernel";
import type { ClientScope } from "../domain/client-scope";
import type { PolicyDirectory, ProducerDirectory } from "../ports/portal-services";
import { type ClientPolicySummaryDto, toClientPolicySummary } from "./portal-dto";

/** Every policy the client is a party to, whoever produced it. */
export function makeListClientPolicies(deps: {
  policies: PolicyDirectory;
  producers: ProducerDirectory;
}) {
  return async function listClientPolicies(
    ctx: TenantContext,
    scope: ClientScope,
  ): Promise<ClientPolicySummaryDto[]> {
    if (scope.policyIds.length === 0) return [];

    const policies = await deps.policies.list(ctx, scope.policyIds);
    const agents = await deps.producers.contacts([...new Set(policies.map((p) => p.producerId))]);

    return policies.map((p) => toClientPolicySummary(p, agents));
  };
}

export type ListClientPolicies = ReturnType<typeof makeListClientPolicies>;

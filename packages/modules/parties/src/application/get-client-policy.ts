import { notFound, type TenantContext } from "@pas/kernel";
import { type ClientScope, clientMaySee } from "../domain/client-scope";
import type {
  BillingDirectory,
  PolicyDirectory,
  ProducerDirectory,
} from "../ports/portal-services";
import { type ClientPolicyDetailDto, toClientPolicyDetail } from "./portal-dto";

export function assertClientMaySee(ctx: TenantContext, scope: ClientScope, policyId: string) {
  if (!clientMaySee(scope, ctx.tenantId, policyId)) throw notFound("Policy", policyId);
}

export function makeGetClientPolicy(deps: {
  policies: PolicyDirectory;
  billing: BillingDirectory;
  producers: ProducerDirectory;
}) {
  return {
    async detail(
      ctx: TenantContext,
      scope: ClientScope,
      input: { id: string },
    ): Promise<ClientPolicyDetailDto> {
      assertClientMaySee(ctx, scope, input.id);

      const [policy, invoices, changeRequests] = await Promise.all([
        deps.policies.detail(ctx, scope.policyIds, input.id),
        deps.billing.invoices(ctx, [input.id]),
        deps.policies.changeRequests(ctx, scope.policyIds, input.id),
      ]);

      const agents = await deps.producers.contacts([policy.producerId]);

      return toClientPolicyDetail(policy, agents, { invoices, changeRequests });
    },
    async document(
      ctx: TenantContext,
      scope: ClientScope,
      input: { policyId: string; documentId: string },
    ) {
      assertClientMaySee(ctx, scope, input.policyId);

      return deps.policies.document(ctx, scope.policyIds, input);
    },
  };
}

export type GetClientPolicy = ReturnType<typeof makeGetClientPolicy>;

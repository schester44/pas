import {
  asId,
  type Clock,
  newId,
  notFound,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { ChangeRequestProps } from "../domain/change-request";
import type { PolicyScope } from "../domain/scope";
import type { ChangeRequestRepository } from "../ports/change-request-repository";
import type { PolicyRepository } from "../ports/policy-repository";

const KIND_LABELS: Record<string, string> = {
  address: "an address change",
  mortgagee: "a mortgagee change",
  coverage: "a coverage change",
  other: "a change",
};

/** Stores the request and puts it on the timeline; the producer works it from there. */
export function makeRequestPolicyChange(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  changeRequests: ChangeRequestRepository;
  clock: Clock;
}) {
  return async function requestPolicyChange(
    ctx: TenantContext,
    scope: PolicyScope,
    input: {
      policyId: string;
      kind: string;
      details: string;
      requester: ChangeRequestProps["requestedBy"];
    },
  ): Promise<{ id: string }> {
    return deps.uow.run(ctx, async (tx) => {
      const policy = await deps.policies.findById(tx, ctx, scope, asId(input.policyId));

      if (!policy) throw notFound("Policy", input.policyId);

      const request: ChangeRequestProps = {
        id: newId(),
        policyId: policy.id,
        kind: input.kind,
        details: input.details,
        status: "open",
        requestedBy: input.requester,
        producerId: policy.toSnapshot().policy.producer.id,
        createdAt: deps.clock.now(),
      };

      await deps.changeRequests.add(tx, ctx, request);

      policy.recordChangeRequest(
        {
          id: request.id,
          kind: request.kind,
          summary: `${input.requester.name} requested ${KIND_LABELS[input.kind] ?? KIND_LABELS.other}`,
          details: request.details,
          actor: { type: "user", id: input.requester.userId, name: input.requester.name },
        },
        deps.clock,
      );

      await deps.policies.save(tx, policy);
      await deps.outbox.add(tx, policy.pullEvents());

      return { id: request.id };
    });
  };
}

export type RequestPolicyChange = ReturnType<typeof makeRequestPolicyChange>;

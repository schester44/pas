import {
  asId,
  notFound,
  type Outbox,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { ProducerOfRecord } from "../domain/policy";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import type { PolicyRepository } from "../ports/policy-repository";
import { type PolicyDetailDto, toPolicyDetailDto } from "./dto";

/** Broker of record change (PLAN §4): moves the policy to another producer and agency. */
export function makeChangeProducer(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  clocks: ClockProvider;
}) {
  return async function changeProducer(
    ctx: TenantContext,
    scope: PolicyScope,
    input: {
      policyId: string;
      producer: ProducerOfRecord;
      effectiveDate: string;
      reason: string;
      actor: TimelineActor;
    },
  ): Promise<PolicyDetailDto> {
    return deps.uow.run(ctx, async (tx) => {
      const policy = await deps.policies.findById(tx, ctx, scope, asId(input.policyId));

      if (!policy) throw notFound("Policy", input.policyId);

      policy.changeProducer(
        {
          producer: input.producer,
          effectiveDate: parsePlainDate(input.effectiveDate),
          reason: input.reason.trim(),
          actor: input.actor,
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.policies.save(tx, policy);
      await deps.outbox.add(tx, policy.pullEvents());

      return toPolicyDetailDto(policy);
    });
  };
}

export type ChangeProducer = ReturnType<typeof makeChangeProducer>;

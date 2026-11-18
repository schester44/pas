import { asId, newId, type TenantContext, type Transaction, type ClockProvider } from "@pas/kernel";
import {
  assertLinked,
  categoryOf,
  type PolicyEventProps,
  type PolicyEventType,
  type TimelineActor,
} from "../domain/policy-event";
import type { PolicyRepository } from "../ports/policy-repository";

/** Appends to a policy's timeline inside the caller's transaction (billing, notes). */
export function makeRecordPolicyEvent(deps: { policies: PolicyRepository; clocks: ClockProvider }) {
  return async function recordPolicyEvent(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      type: PolicyEventType;
      actor: TimelineActor;
      summary: string;
      data: Record<string, unknown>;
      transactionId?: string;
      invoiceId?: string;
    },
  ): Promise<void> {
    const event: PolicyEventProps = {
      id: newId(),
      termId: null,
      transactionId: input.transactionId ?? null,
      invoiceId: input.invoiceId ?? null,
      type: input.type,
      category: categoryOf(input.type),
      occurredAt: deps.clocks.forTenant(ctx.tenantId).now(),
      effectiveDate: null,
      actor: input.actor,
      summary: input.summary,
      data: input.data,
    };

    assertLinked(event);
    await deps.policies.appendEvent(tx, ctx, asId(input.policyId), event);
  };
}

export type RecordPolicyEvent = ReturnType<typeof makeRecordPolicyEvent>;

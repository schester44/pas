import { asId, type Clock, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyRepository } from "../ports/policy-repository";

export function makeAttachPolicyDocuments(deps: {
  uow: UnitOfWork;
  policies: PolicyRepository;
  clock: Clock;
}) {
  return async function attachPolicyDocuments(
    ctx: TenantContext,
    input: {
      policyId: string;
      transactionId: string;
      documents: { kind: string; title: string; storageKey: string; sizeBytes: number }[];
      actor: TimelineActor;
    },
  ): Promise<void> {
    await deps.uow.run(ctx, async (tx) => {
      const policy = await deps.policies.findById(
        tx,
        ctx,
        { kind: "tenant" },
        asId(input.policyId),
      );

      if (!policy) throw notFound("Policy", input.policyId);

      const before = policy.toSnapshot().documents.length;

      for (const document of input.documents) {
        policy.attachDocument({ ...document, transactionId: input.transactionId }, deps.clock);
      }

      if (policy.toSnapshot().documents.length > before) {
        policy.recordDocumentsGenerated(
          input.transactionId,
          input.documents.map((d) => d.title),
          input.actor,
          deps.clock,
        );
      }

      await deps.policies.save(tx, policy);
    });
  };
}

export type AttachPolicyDocuments = ReturnType<typeof makeAttachPolicyDocuments>;

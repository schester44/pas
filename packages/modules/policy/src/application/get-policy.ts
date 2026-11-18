import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { PolicyScope } from "../domain/scope";
import type { PolicyRepository } from "../ports/policy-repository";
import { type PolicyDetailDto, toPolicyDetailDto } from "./dto";

export function makeGetPolicy(deps: {
  uow: UnitOfWork;
  policies: PolicyRepository;
  storage: ObjectStorage;
}) {
  async function load(ctx: TenantContext, scope: PolicyScope, id: string) {
    const policy = await deps.uow.run(ctx, (tx) =>
      deps.policies.findById(tx, ctx, scope, asId(id)),
    );

    if (!policy) throw notFound("Policy", id);

    return policy;
  }

  return {
    async detail(
      ctx: TenantContext,
      scope: PolicyScope,
      input: { id: string },
    ): Promise<PolicyDetailDto> {
      return toPolicyDetailDto(await load(ctx, scope, input.id));
    },
    async document(
      ctx: TenantContext,
      scope: PolicyScope,
      input: { policyId: string; documentId: string },
    ): Promise<{ title: string; fileName: string; body: Uint8Array }> {
      const policy = await load(ctx, scope, input.policyId);
      const document = policy.toSnapshot().documents.find((d) => d.id === input.documentId);

      if (!document) throw notFound("Policy document", input.documentId);

      const file = await deps.storage.get(document.storageKey);

      if (!file) throw notFound("Policy document file", input.documentId);

      const slug = document.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      return { title: document.title, fileName: `${policy.number}-${slug}.pdf`, body: file.body };
    },
  };
}

export type GetPolicy = ReturnType<typeof makeGetPolicy>;

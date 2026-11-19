import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { exposureLabels } from "../domain/exposures";
import type { Policy } from "../domain/policy";
import type { PolicyScope } from "../domain/scope";
import { coveragesOf } from "../domain/term-state";
import type { PolicyProductConfig } from "../ports/product-config";
import type { PolicyRepository } from "../ports/policy-repository";
import { type PolicyDetailDto, toPolicyDetailDto } from "./dto";

export function makeGetPolicy(deps: {
  uow: UnitOfWork;
  policies: PolicyRepository;
  storage: ObjectStorage;
  config?: Pick<PolicyProductConfig, "release">;
}) {
  /** Names for every exposure the term's versions and lines use, by row id or by position. */
  async function labelsOf(ctx: TenantContext, policy: Policy) {
    if (!deps.config) return {};

    const term = policy.currentTerm;
    const release = await deps.config.release(ctx, term.productReleaseId);
    const state = policy.toSnapshot();
    const versions = state.versions.filter((v) => v.termId === term.id).toReversed();

    return exposureLabels(
      release.riskSchema,
      release.forms.map((f) => f.form),
      versions.map((v) => v.snapshot.risk),
      [
        ...versions.flatMap((v) => coveragesOf(v.snapshot).map((c) => c.exposure)),
        ...versions.flatMap((v) =>
          ((v.snapshot.coverages ?? []) as { exposure?: string }[]).map((c) => c.exposure),
        ),
        ...state.financials.map((f) => f.exposure),
      ],
    );
  }

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
      const policy = await load(ctx, scope, input.id);

      return toPolicyDetailDto(policy, await labelsOf(ctx, policy));
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

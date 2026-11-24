import {
  type BindingInvoker,
  checkActionInput,
  type DisplayBlock,
  type ExtensionBinding,
  type ExtensionSurface,
  noExtensions,
  surfacesFor,
} from "@pas/extension-points";
import { asId, invalid, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { PolicyScope } from "../domain/scope";
import type { PolicyProductConfig } from "../ports/product-config";
import type { PolicyRepository } from "../ports/policy-repository";

interface Deps {
  uow: UnitOfWork;
  policies: PolicyRepository;
  config: Pick<PolicyProductConfig, "release">;
  extensions?: BindingInvoker;
}

async function load(deps: Deps, ctx: TenantContext, scope: PolicyScope, policyId: string) {
  const policy = await deps.uow.run(ctx, (tx) =>
    deps.policies.findById(tx, ctx, scope, asId(policyId)),
  );

  if (!policy) throw notFound("Policy", policyId);

  const term = policy.currentTerm;
  const release = await deps.config.release(ctx, term.productReleaseId);

  return {
    release,
    record: {
      type: "policy",
      id: policy.id,
      number: policy.number,
      term: {
        id: term.id,
        status: term.status,
        effectiveDate: term.effectiveDate.toString(),
        expirationDate: term.expirationDate.toString(),
        writtenPremium: term.writtenPremium.toString(),
        currency: term.writtenPremium.currency,
      },
      jurisdiction: term.jurisdiction,
      product: { id: release.productId, version: release.version },
      risk: policy.latestVersion(term.id).snapshot.risk ?? {},
    },
  };
}

function bindingOf<P extends "record_panel" | "action">(
  bindings: readonly ExtensionBinding[],
  id: string,
  point: P,
) {
  const binding = bindings.find((b) => b.id === id && b.point === point && b.record === "policy");

  if (!binding) throw notFound("Extension", id);

  return binding as ExtensionBinding & { point: P };
}

/** Panels and actions the policy's product puts on its page. */
export function makePolicyExtensions(deps: Deps) {
  const invoker = () => deps.extensions ?? noExtensions;

  return {
    async surfaces(ctx: TenantContext, scope: PolicyScope, input: { policyId: string }) {
      const { release } = await load(deps, ctx, scope, input.policyId);

      return surfacesFor(release.extensions, "policy") satisfies ExtensionSurface[];
    },

    async panel(
      ctx: TenantContext,
      scope: PolicyScope,
      input: { policyId: string; bindingId: string },
    ): Promise<DisplayBlock[] | null> {
      const { release, record } = await load(deps, ctx, scope, input.policyId);
      const binding = bindingOf(release.extensions, input.bindingId, "record_panel");

      const output = await invoker().invoke(
        ctx,
        binding,
        { record },
        { type: "policy", id: record.id },
      );

      return output?.blocks ?? null;
    },

    /** Policy changes go through endorsements, so a policy action can't return a changeset. */
    async action(
      ctx: TenantContext,
      scope: PolicyScope,
      input: { policyId: string; bindingId: string; values: Record<string, unknown> },
    ): Promise<{ message: string | null; blocks: DisplayBlock[] }> {
      const { release, record } = await load(deps, ctx, scope, input.policyId);
      const binding = bindingOf(release.extensions, input.bindingId, "action");
      const values = checkActionInput(binding.inputFields ?? [], input.values);

      const output = await invoker().invoke(
        ctx,
        binding,
        { record, input: values },
        { type: "policy", id: record.id },
      );

      if (output?.changeset) {
        throw invalid("Actions on a policy can't change it; start an endorsement instead", {
          reason: "changeset_not_allowed",
        });
      }

      return { message: output?.message ?? null, blocks: output?.blocks ?? [] };
    },
  };
}

export type PolicyExtensions = ReturnType<typeof makePolicyExtensions>;

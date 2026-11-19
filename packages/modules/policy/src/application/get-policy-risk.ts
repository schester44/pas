import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { TenantContext } from "@pas/kernel";
import type { PolicyScope } from "../domain/scope";
import { type ChangeDeps, loadPolicy } from "./pricing";

export interface PolicyRiskDto {
  schema: RiskSchema;
  form: FormDefinition | null;
  risk: Record<string, unknown>;
}

/** The current term's risk as last issued, with the release's schema and quote form to display it. */
export function makeGetPolicyRisk(deps: Pick<ChangeDeps, "uow" | "policies" | "config">) {
  return async function getPolicyRisk(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string },
  ): Promise<PolicyRiskDto> {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const term = policy.currentTerm;
    const snapshot = policy.latestVersion(term.id).snapshot;
    const release = await deps.config.release(ctx, term.productReleaseId);

    const quote =
      release.forms.find((f) => f.stage === "quote" && f.channel === "agent") ??
      release.forms.find((f) => f.stage === "quote") ??
      release.forms[0];

    return {
      schema: release.riskSchema,
      form: quote?.form ?? null,
      risk: (snapshot.risk ?? {}) as Record<string, unknown>,
    };
  };
}

export type GetPolicyRisk = ReturnType<typeof makeGetPolicyRisk>;

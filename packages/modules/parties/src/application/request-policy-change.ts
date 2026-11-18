import { invalid, type TenantContext } from "@pas/kernel";
import type { ClientScope } from "../domain/client-scope";
import type { PolicyDirectory } from "../ports/portal-services";
import { assertClientMaySee } from "./get-client-policy";

export const CHANGE_KINDS = ["address", "mortgagee", "coverage", "other"] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** A client's change request, routed to the producer of record as a timeline event. */
export function makeRequestPolicyChange(deps: { policies: PolicyDirectory }) {
  return async function requestPolicyChange(
    ctx: TenantContext,
    scope: ClientScope,
    input: {
      policyId: string;
      kind: ChangeKind;
      details: string;
      requester: { name: string; email: string };
    },
  ): Promise<{ id: string }> {
    assertClientMaySee(ctx, scope, input.policyId);

    const details = input.details.trim();

    if (details.length < 3) throw invalid("Describe the change you need", { field: "details" });

    return deps.policies.requestChange(ctx, scope.policyIds, {
      policyId: input.policyId,
      kind: input.kind,
      details,
      requester: { userId: scope.userId, ...input.requester },
    });
  };
}

export type RequestPolicyChange = ReturnType<typeof makeRequestPolicyChange>;

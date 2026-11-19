import { invalid, type TenantContext } from "@pas/kernel";
import type { ClientScope } from "../domain/client-scope";
import type { PostalAddress } from "../domain/contact";
import type { PolicyDirectory } from "../ports/portal-services";
import { assertClientMaySee } from "./get-client-policy";

export const CHANGE_KINDS = ["address", "mortgagee", "coverage", "other"] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** A client's change request, routed to the producer of record as a timeline event. */
export function makeRequestPolicyChange(deps: {
  policies: PolicyDirectory;
  /** The address registry: a new mailing address arrives verified (or marked as entered). */
  addresses: {
    resolve(ctx: TenantContext, address: PostalAddress): Promise<{ value: PostalAddress }>;
  };
}) {
  return async function requestPolicyChange(
    ctx: TenantContext,
    scope: ClientScope,
    input: {
      policyId: string;
      kind: ChangeKind;
      details: string;
      address?: PostalAddress;
      requester: { name: string; email: string };
    },
  ): Promise<{ id: string }> {
    assertClientMaySee(ctx, scope, input.policyId);

    const details = input.details.trim();

    if (details.length < 3 && !input.address) {
      throw invalid("Describe the change you need", { field: "details" });
    }

    const address = input.address && (await deps.addresses.resolve(ctx, input.address)).value;

    const described = address
      ? [details, `New mailing address: ${formatted(address)}`].filter(Boolean).join("\n\n")
      : details;

    return deps.policies.requestChange(ctx, scope.policyIds, {
      policyId: input.policyId,
      kind: input.kind,
      details: described,
      requester: { userId: scope.userId, ...input.requester },
    });
  };
}

export type RequestPolicyChange = ReturnType<typeof makeRequestPolicyChange>;

function formatted(address: PostalAddress): string {
  const street = [address.line1, address.line2].filter(Boolean).join(" ");
  const line = `${street}, ${address.city}, ${address.region} ${address.postalCode}`;

  return address.verified === false ? `${line} (not verified; used as entered)` : line;
}

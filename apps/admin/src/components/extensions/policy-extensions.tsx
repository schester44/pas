import { ExtensionSurfaces } from "@pas/ui/components/extension-surfaces";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAccess } from "@/lib/permissions";
import { trpcClient, useTRPC } from "@/lib/trpc";

/** Panels and actions the policy's product binds to the policy page. */
export function PolicyExtensions({ policyId }: { policyId: string }) {
  const trpc = useTRPC();
  const access = useAccess();
  const surfaces = useQuery(trpc.policies.extensionSurfaces.queryOptions({ policyId }));

  const loadPanel = useCallback(
    (bindingId: string) => trpcClient.policies.extensionPanel.query({ policyId, bindingId }),
    [policyId],
  );

  const runAction = useCallback(
    (bindingId: string, values: Record<string, unknown>) =>
      trpcClient.policies.extensionAction.mutate({ policyId, bindingId, values }),
    [policyId],
  );

  if (!surfaces.data?.length) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ExtensionSurfaces
        surfaces={surfaces.data}
        loadPanel={loadPanel}
        runAction={runAction}
        canAct={access.policies.update}
      />
    </div>
  );
}

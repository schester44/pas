import type { ExtensionSurface } from "@pas/extension-points";
import { ExtensionSurfaces } from "@pas/ui/components/extension-surfaces";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { trpcClient, useTRPC } from "@/lib/trpc";

/** Panels and actions the submission's product binds to the submission page. */
export function SubmissionExtensions({
  submissionId,
  surfaces,
  canAct,
}: {
  submissionId: string;
  surfaces: readonly ExtensionSurface[];
  canAct: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const loadPanel = useCallback(
    (bindingId: string) => trpcClient.submissions.extensionPanel.query({ submissionId, bindingId }),
    [submissionId],
  );

  const runAction = useCallback(
    (bindingId: string, values: Record<string, unknown>) =>
      trpcClient.submissions.extensionAction.mutate({ submissionId, bindingId, values }),
    [submissionId],
  );

  return (
    <ExtensionSurfaces
      surfaces={surfaces}
      loadPanel={loadPanel}
      runAction={runAction}
      canAct={canAct}
      onActionDone={(outcome) =>
        outcome.applied?.length
          ? void queryClient.invalidateQueries({
              queryKey: trpc.submissions.get.queryKey({ id: submissionId }),
            })
          : undefined
      }
    />
  );
}

import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type PolicyClient = AdminOutputs["policies"]["clients"][number];

export const PARTY_ROLE_LABELS: Record<string, string> = {
  named_insured: "Named insured",
  additional_named_insured: "Additional named insured",
  authorized_contact: "Authorized contact",
};

export function portalState(client: Pick<PolicyClient, "portalUsers" | "invitedAt">) {
  if (client.portalUsers > 0) return "Using the portal";

  return client.invitedAt ? `Invited ${formatDate(client.invitedAt)}` : "Not invited";
}

/** The client accounts on a policy, with their portal access. */
export function PolicyClients({ policyId }: { policyId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const clients = useQuery(trpc.policies.clients.queryOptions({ id: policyId }));
  const resend = useMutation(trpc.policies.resendInvite.mutationOptions());

  return (
    <Panel title="Clients" flush>
      {clients.data?.length === 0 ? (
        <EmptyState title="No client accounts linked" />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {clients.isPending && (
            <li className="px-(--card-p) py-3.5">
              <div className="h-9 animate-pulse rounded bg-muted" />
            </li>
          )}
          {clients.data?.map((client) => {
            const sent = resend.isSuccess && resend.variables.clientAccountId === client.id;
            const sending = resend.isPending && resend.variables.clientAccountId === client.id;

            return (
              <li key={`${client.id}-${client.role}`} className="grid gap-2 px-(--card-p) py-3">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm font-medium">{client.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {PARTY_ROLE_LABELS[client.role] ?? client.role}
                    {client.emails[0] && ` · ${client.emails[0].address}`}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {portalState(client)}
                  </span>
                </span>
                {client.emails.length > 0 && (
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sending || sent}
                      onClick={() =>
                        resend.mutate(
                          { policyId, clientAccountId: client.id },
                          {
                            onSuccess: () =>
                              queryClient.invalidateQueries({
                                queryKey: trpc.policies.clients.queryKey({ id: policyId }),
                              }),
                          },
                        )
                      }
                    >
                      {sending ? <Spinner /> : sent && <Check />}
                      {sent ? "Invite sent" : "Resend portal invite"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

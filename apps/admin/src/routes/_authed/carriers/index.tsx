import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { CarrierForm, EMPTY_CARRIER } from "@/components/carriers/carrier-form";
import { capabilityLabel, MODES } from "@/components/carriers/labels";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/")({
  component: CarriersPage,
});

function CarriersPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const access = useAccess();
  const queryClient = useQueryClient();
  const carriers = useQuery(trpc.carriers.list.queryOptions());
  const [creating, setCreating] = useState(false);

  const create = useMutation(
    trpc.carriers.save.mutationOptions({
      onSuccess: async (carrier) => {
        await queryClient.invalidateQueries({ queryKey: trpc.carriers.list.queryKey() });
        setCreating(false);
        void navigate({ to: "/carriers/$carrierId", params: { carrierId: carrier.id } });
      },
    }),
  );

  return (
    <>
      <PageHeader
        title="Carriers"
        actions={
          access.products.write && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New carrier
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {carriers.error && (
          <Notice tone="error" title="Couldn't load carriers">
            {carriers.error.message}
          </Notice>
        )}
        <Panel flush>
          {carriers.data?.length === 0 ? (
            <EmptyState
              title="No carriers yet"
              description="Add the carriers you write business with."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Connected by</TableHead>
                  <TableHead>Connector</TableHead>
                  <TableHead>Admitted in</TableHead>
                  <TableHead>Environment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(carriers.data ?? []).map((carrier) => (
                  <TableRow
                    key={carrier.id}
                    className="h-13 cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      navigate({ to: "/carriers/$carrierId", params: { carrierId: carrier.id } })
                    }
                  >
                    <TableCell>
                      <span className="grid gap-0.5">
                        <span className="font-medium">{carrier.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {[carrier.naic && `NAIC ${carrier.naic}`, carrier.amBest]
                            .filter(Boolean)
                            .join(" · ") || carrier.key}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{MODES[carrier.mode]}</TableCell>
                    <TableCell>
                      {carrier.connector ? (
                        <span className="grid gap-0.5">
                          <span className="tabular-nums">Version {carrier.connector.version}</span>
                          <span className="text-xs text-muted-foreground">
                            {carrier.connector.capabilities.map(capabilityLabel).join(", ")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not published</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {carrier.admitted.join(", ") || "–"}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        tone={carrier.activeEnvironment === "live" ? "success" : "neutral"}
                      >
                        {carrier.activeEnvironment === "live" ? "Live" : "Test"}
                      </StatusChip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageBody>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New carrier</DialogTitle>
            <DialogDescription>
              Connect it next: a configured connector, an extension or file feeds.
            </DialogDescription>
          </DialogHeader>
          <CarrierForm
            initial={EMPTY_CARRIER}
            submitLabel="Create carrier"
            busy={create.isPending}
            error={create.error?.message ?? null}
            onSubmit={(values) => create.mutate(values)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

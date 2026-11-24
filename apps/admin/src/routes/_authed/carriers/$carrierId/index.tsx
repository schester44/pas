import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { EmptyState } from "@pas/ui/components/empty-state";
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
import { CarrierForm } from "@/components/carriers/carrier-form";
import { capabilityLabel, RUN_TONES, runLabel } from "@/components/carriers/labels";
import { formatRelative } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/$carrierId/")({
  component: CarrierOverview,
});

const subjectLabel = (subject: { kind: string }) =>
  ({
    quote: "Quote",
    new_business: "New business",
    transaction: "Policy change",
    test: "Test console",
  })[subject.kind] ?? subject.kind;

function CarrierOverview() {
  const { carrierId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const carrier = useQuery(trpc.carriers.get.queryOptions({ id: carrierId }));

  const runs = useQuery(
    trpc.carriers.runs.list.queryOptions({ carrierId }, { refetchInterval: 5000 }),
  );

  const save = useMutation(
    trpc.carriers.save.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.carriers.get.queryKey({ id: carrierId }) }),
    }),
  );

  if (!carrier.data)
    return (
      <PageBody className="max-w-6xl">
        <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
      </PageBody>
    );

  const c = carrier.data;

  return (
    <PageBody className="max-w-6xl">
      <Panel
        title="Profile"
        description="Who the carrier is and where it writes. Products name it by its key."
      >
        <CarrierForm
          key={c.updatedAt}
          initial={c}
          submitLabel="Save profile"
          busy={save.isPending}
          error={save.error?.message ?? null}
          readOnly={!access.products.write}
          onSubmit={(values) => save.mutate({ ...values, id: c.id })}
        />
      </Panel>
      <Panel
        flush
        title="Carrier conversations"
        description="Every capability run, live and from the test console."
      >
        {runs.data?.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Runs appear when a quote, bind or policy change goes to the carrier."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Connector</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(runs.data ?? []).map((run) => (
                <TableRow
                  key={run.id}
                  className="h-13 cursor-pointer hover:bg-muted/40"
                  onClick={() =>
                    navigate({
                      to: "/carriers/$carrierId/console",
                      params: { carrierId },
                      search: { run: run.id },
                    })
                  }
                >
                  <TableCell className="font-medium">{capabilityLabel(run.capability)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {subjectLabel(run.subject)} · {run.environment === "live" ? "Live" : "Test"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {run.connectorVersion ? `v${run.connectorVersion}` : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={RUN_TONES[run.status] ?? "neutral"}>
                      {runLabel(run.status)}
                    </StatusChip>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatRelative(run.startedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </PageBody>
  );
}

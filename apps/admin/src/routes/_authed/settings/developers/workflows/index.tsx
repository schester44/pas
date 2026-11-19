import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search, Workflow, X } from "lucide-react";
import { useState } from "react";
import {
  RUN_STATUSES,
  type RunStatus,
  RunStatusChip,
  runStatusLabel,
  WORKFLOWS,
  workflowName,
} from "@/components/workflows/labels";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

interface RunSearch {
  workflow?: string;
  status?: RunStatus;
  q?: string;
  subject?: string;
}

const ALL = "all";
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export const Route = createFileRoute("/_authed/settings/developers/workflows/")({
  validateSearch: (search: Record<string, unknown>): RunSearch => {
    const status = RUN_STATUSES.find((s) => s === search.status);

    return {
      ...(text(search.workflow) && { workflow: text(search.workflow) }),
      ...(status && { status }),
      ...(text(search.q) && { q: text(search.q) }),
      ...(text(search.subject) && { subject: text(search.subject) }),
    };
  },
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const trpc = useTRPC();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [query, setQuery] = useState(search.q ?? "");

  const runs = useQuery({
    ...trpc.workflows.list.queryOptions({
      workflowId: search.workflow,
      status: search.status,
      q: search.q,
      subject: search.subject,
    }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

  const reconcile = useMutation(trpc.workflows.reconcile.mutationOptions());

  const update = (patch: Partial<RunSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <>
      <PageHeader
        title="Workflows"
        actions={
          <Button
            variant="outline"
            disabled={reconcile.isPending}
            onClick={() => reconcile.mutate({ days: 30 })}
          >
            {reconcile.isPending && <Spinner />}
            Run reconciliation
          </Button>
        }
      />
      <PageBody className="max-w-6xl">
        {reconcile.isSuccess && (
          <Notice title="Reconciliation queued">
            Issued transactions from the last 30 days get any missing obligations and commissions.
          </Notice>
        )}
        {(runs.error ?? reconcile.error) && (
          <Notice tone="error" title="Something went wrong">
            {(runs.error ?? reconcile.error)?.message}
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative w-full sm:w-72"
            onSubmit={(event) => {
              event.preventDefault();
              void update({ q: query.trim() || undefined });
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Policy or submission number"
              className="h-8 pl-8"
              aria-label="Search by policy or submission number"
            />
          </form>
          {search.subject && (
            <Button variant="outline" size="sm" onClick={() => update({ subject: undefined })}>
              {search.subject.startsWith("policy:") ? "This policy's runs" : "Filtered by record"}{" "}
              <X />
            </Button>
          )}
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Select
              value={search.workflow ?? ALL}
              onValueChange={(value) => update({ workflow: value === ALL ? undefined : value })}
            >
              <SelectTrigger size="sm" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All workflows</SelectItem>
                {Object.entries(WORKFLOWS).map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={search.status ?? ALL}
              onValueChange={(value) =>
                update({ status: value === ALL ? undefined : (value as RunStatus) })
              }
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any status</SelectItem>
                {RUN_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {runStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Panel flush>
          {!runs.data ? (
            <div className="divide-y">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-13 animate-pulse bg-muted/30" />
              ))}
            </div>
          ) : runs.data.length === 0 ? (
            <EmptyState
              icon={<Workflow />}
              title="No runs match"
              description="Runs start as quotes, policies, invoices and obligations move through their dates."
            />
          ) : (
            <RunsTable runs={runs.data} />
          )}
        </Panel>
      </PageBody>
    </>
  );
}

type Run = {
  runId: string;
  workflowId: string;
  status: RunStatus;
  label: string;
  reference: string | null;
  error: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
};

function RunsTable({ runs }: { runs: Run[] }) {
  const navigate = useNavigate();

  const open = (runId: string) =>
    navigate({ to: "/settings/developers/workflows/$runId", params: { runId } });

  return (
    <>
      <Table className="hidden lg:table">
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Record</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.runId}
              tabIndex={0}
              onClick={() => open(run.runId)}
              onKeyDown={(event) => event.key === "Enter" && open(run.runId)}
              className="cursor-pointer outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <TableCell className="whitespace-normal">
                <span className="grid gap-0.5">
                  <span className="text-sm leading-5 font-medium">
                    {workflowName(run.workflowId)}
                  </span>
                  <span className="text-xs text-muted-foreground">{run.label}</span>
                </span>
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {run.reference ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <RunStatusChip status={run.status} />
              </TableCell>
              <TableCell className="w-64 text-sm whitespace-normal text-muted-foreground">
                {run.error ?? run.cancelReason ?? ""}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                {formatRelative(run.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ul className="m-0 list-none divide-y p-0 lg:hidden">
        {runs.map((run) => (
          <li key={run.runId}>
            <Link
              to="/settings/developers/workflows/$runId"
              params={{ runId: run.runId }}
              className="flex items-start justify-between gap-4 px-(--card-p) py-3 hover:bg-muted/40"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm leading-5 font-medium">
                  {workflowName(run.workflowId)}
                </span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {[run.reference, run.label].filter(Boolean).join(" · ")}
                </span>
                {(run.error ?? run.cancelReason) && (
                  <span className="truncate text-xs text-muted-foreground">
                    {run.error ?? run.cancelReason}
                  </span>
                )}
              </span>
              <RunStatusChip status={run.status} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

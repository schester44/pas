import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { StatusChip } from "@pas/ui/components/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SkeletonRows } from "@/components/catalog/skeleton-rows";
import { useExtensionEditor } from "@/components/extensions/extension-editor";
import { pointLabel, RUN_STATUS } from "@/components/extensions/labels";
import { RunResult } from "@/components/extensions/run-result";
import { formatDateTime } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Filter = "all" | "failed";

export const Route = createFileRoute("/_authed/extensions/$extensionId/runs")({
  validateSearch: (search: Record<string, unknown>): { run?: string; filter?: Filter } => ({
    ...(typeof search.run === "string" && { run: search.run }),
    ...(search.filter === "failed" && { filter: "failed" as const }),
  }),
  component: RunsTab,
});

const SUBJECTS: Record<string, string> = {
  submission: "Submission",
  policy: "Policy",
  automation: "Automation",
  extension_test: "Test",
  extension_try: "Try it",
};

function RunsTab() {
  const trpc = useTRPC();
  const { extension } = useExtensionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = search.filter ?? "all";

  const runs = useQuery(
    trpc.extensions.runs.queryOptions({
      extensionId: extension.id,
      limit: 100,
      ...(filter === "failed" && { status: "failed" as const }),
    }),
  );

  const run = useQuery({
    ...trpc.extensions.run.queryOptions({ id: search.run ?? "" }),
    enabled: !!search.run,
  });

  return (
    <PageBody className="max-w-6xl">
      <SegmentedControl
        label="Runs"
        value={filter}
        onValueChange={(next) =>
          navigate({ search: next === "failed" ? { filter: "failed" } : {} })
        }
        options={[
          { value: "all", label: "All runs" },
          { value: "failed", label: "Failed" },
        ]}
      />
      <Panel flush>
        {runs.data?.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Runs from products, tests and automations show up here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Point</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!runs.data ? (
                <SkeletonRows columns={6} />
              ) : (
                runs.data.map((r) => {
                  const status = RUN_STATUS[r.status] ?? {
                    label: r.status,
                    tone: "neutral" as const,
                  };

                  return (
                    <TableRow
                      key={r.id}
                      className="h-13 cursor-pointer hover:bg-muted/40"
                      onClick={() => navigate({ search: { ...search, run: r.id } })}
                    >
                      <TableCell className="tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
                      <TableCell>{pointLabel(r.point)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.subject ? (SUBJECTS[r.subject.type] ?? r.subject.type) : "–"}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {r.version ? `v${r.version}` : "Draft"}
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.stats.wallMs} ms</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Panel>
      <Sheet
        open={!!search.run}
        onOpenChange={(open) =>
          !open && navigate({ search: { ...(filter === "failed" && { filter }) } })
        }
      >
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{run.data ? pointLabel(run.data.point) : "Run"}</SheetTitle>
            {run.data && <SheetDescription>{formatDateTime(run.data.createdAt)}</SheetDescription>}
          </SheetHeader>
          <SheetBody>{run.data && <RunResult run={run.data} />}</SheetBody>
        </SheetContent>
      </Sheet>
    </PageBody>
  );
}

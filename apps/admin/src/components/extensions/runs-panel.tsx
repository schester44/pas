import { EmptyState } from "@pas/ui/components/empty-state";
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
import { SkeletonRows } from "@/components/catalog/skeleton-rows";
import { formatDateTime } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { pointLabel, RUN_STATUS } from "./labels";
import { RunResult } from "./run-result";

export type RunFilter = "all" | "failed";

const SUBJECTS: Record<string, string> = {
  submission: "Submission",
  policy: "Policy",
  automation: "Automation",
  enrichment_transform: "Enrichment",
  extension_test: "Test",
  extension_try: "Try it",
};

/** Runs for one extension, or every extension when `extensionId` is absent. */
export function RunsPanel({
  extensionId,
  filter,
  runId,
  onFilter,
  onOpen,
  onClose,
}: {
  extensionId?: string;
  filter: RunFilter;
  runId?: string;
  onFilter: (filter: RunFilter) => void;
  onOpen: (runId: string) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const names = useQuery({ ...trpc.extensions.list.queryOptions(), enabled: !extensionId });
  const name = (id: string) => names.data?.find((e) => e.id === id)?.name ?? "Extension";

  const runs = useQuery(
    trpc.extensions.runs.queryOptions({
      limit: 100,
      ...(extensionId && { extensionId }),
      ...(filter === "failed" && { status: "failed" as const }),
    }),
  );

  const run = useQuery({
    ...trpc.extensions.run.queryOptions({ id: runId ?? "" }),
    enabled: !!runId,
  });

  const columns = extensionId ? 6 : 7;

  return (
    <>
      <SegmentedControl
        label="Runs"
        value={filter}
        onValueChange={(next) => onFilter(next as RunFilter)}
        options={[
          { value: "all", label: "All runs" },
          { value: "failed", label: "Failed" },
        ]}
      />
      <Panel flush>
        {runs.data?.length === 0 ? (
          <EmptyState
            title={filter === "failed" ? "No failed runs" : "No runs yet"}
            description="Runs from products, tests and automations show up here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                {!extensionId && <TableHead>Extension</TableHead>}
                <TableHead>Point</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!runs.data ? (
                <SkeletonRows columns={columns} />
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
                      onClick={() => onOpen(r.id)}
                    >
                      <TableCell className="tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
                      {!extensionId && (
                        <TableCell className="font-medium">{name(r.extensionId)}</TableCell>
                      )}
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
      <Sheet open={!!runId} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{run.data ? pointLabel(run.data.point) : "Run"}</SheetTitle>
            {run.data && <SheetDescription>{formatDateTime(run.data.createdAt)}</SheetDescription>}
          </SheetHeader>
          <SheetBody>{run.data && <RunResult run={run.data} />}</SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

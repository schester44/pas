import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
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
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  downloadFile,
  kindLabel,
  type ObligationSummary,
  ObligationState,
  stateLabel,
  subjectLabel,
} from "@/components/compliance/labels";
import { formatDate, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type View = "due" | "overdue" | "rejected" | "done" | "all";

const ALL = "*";

export const Route = createFileRoute("/_authed/compliance/")({
  component: CompliancePage,
});

function CompliancePage() {
  const trpc = useTRPC();
  const [view, setView] = useState<View>("due");
  const [state, setState] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const overview = useQuery(trpc.compliance.overview.queryOptions());

  const list = useQuery(
    trpc.compliance.list.queryOptions({
      view,
      ...(state !== ALL && { jurisdiction: state }),
      ...(kind !== ALL && { kind: kind as "sl_filing" }),
    }),
  );

  const counts = overview.data?.counts;
  const states = overview.data?.byState ?? [];

  return (
    <>
      <PageHeader title="Compliance" />
      <PageBody className="gap-8">
        {overview.error && (
          <Notice tone="error" title="Couldn't load compliance">
            {overview.error.message}
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Stat
            label="Overdue"
            value={counts?.overdue}
            tone="danger"
            onClick={() => setView("overdue")}
          />
          <Stat
            label="Due in the next 7 days"
            value={overview.data?.dueSoon}
            onClick={() => setView("due")}
          />
          <Stat
            label="Rejected"
            value={counts?.rejected}
            tone="warning"
            onClick={() => setView("rejected")}
          />
          <Stat
            label="Awaiting an answer"
            value={counts?.submitted}
            onClick={() => setView("all")}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Breakdown
            title="By state"
            rows={states}
            label={stateLabel}
            onSelect={(key) => setState(key)}
          />
          <Breakdown
            title="By licensee"
            rows={overview.data?.byLicensee ?? []}
            label={(_, l) => l}
          />
          <Breakdown
            title="By kind"
            rows={overview.data?.byKind ?? []}
            label={(key) => kindLabel(key)}
            onSelect={(key) => setKind(key)}
          />
        </div>

        <ObligationsTable
          view={view}
          onView={setView}
          state={state}
          onState={setState}
          kind={kind}
          onKind={setKind}
          states={states.map((s) => s.key)}
          obligations={list.data}
          loading={list.isPending}
          error={list.error?.message}
        />

        <Batches />
      </PageBody>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number | undefined;
  tone?: "danger" | "warning";
  onClick: () => void;
}) {
  return (
    <Card className="transition-colors hover:bg-muted/40">
      <button
        type="button"
        onClick={onClick}
        className="grid w-full gap-1 rounded-xl p-(--card-p) text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {tone && !!value && (
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                tone === "danger" ? "bg-red-500" : "bg-amber-500",
              )}
            />
          )}
          {label}
        </span>
        {value === undefined ? (
          <span className="h-9 w-12 animate-pulse rounded bg-muted" />
        ) : (
          <span className="text-3xl leading-9 font-semibold tracking-tight tabular-nums">
            {value}
          </span>
        )}
      </button>
    </Card>
  );
}

type BreakdownRow = {
  key: string;
  label: string;
  due: number;
  overdue: number;
  rejected: number;
  submitted: number;
};

function Breakdown({
  title,
  rows,
  label,
  onSelect,
}: {
  title: string;
  rows: BreakdownRow[];
  label: (key: string, label: string) => string;
  onSelect?: (key: string) => void;
}) {
  return (
    <Panel title={title} flush>
      {rows.length === 0 ? (
        <p className="m-0 px-(--card-p) py-6 text-sm text-muted-foreground">Nothing open.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">Due</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Rejected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 6).map((row) => (
              <TableRow
                key={row.key}
                className={cn(onSelect && "cursor-pointer hover:bg-muted/40")}
                onClick={() => onSelect?.(row.key)}
              >
                <TableCell className="max-w-40 truncate font-medium">
                  {label(row.key, row.label)}
                </TableCell>
                <Count value={row.due} />
                <Count value={row.overdue} tone="text-red-700" />
                <Count value={row.rejected} tone="text-amber-700" />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

const Count = ({ value, tone }: { value: number; tone?: string }) => (
  <TableCell
    className={cn("text-right tabular-nums", value === 0 ? "text-muted-foreground" : tone)}
  >
    {value === 0 ? "–" : value}
  </TableCell>
);

const VIEWS: { value: View; label: string }[] = [
  { value: "due", label: "Due" },
  { value: "overdue", label: "Overdue" },
  { value: "rejected", label: "Rejected" },
  { value: "done", label: "Submitted" },
  { value: "all", label: "All" },
];

function ObligationsTable(props: {
  view: View;
  onView: (view: View) => void;
  state: string;
  onState: (state: string) => void;
  kind: string;
  onKind: (kind: string) => void;
  states: string[];
  obligations: ObligationSummary[] | undefined;
  loading: boolean;
  error?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const rows = props.obligations ?? [];
  const selectable = rows.filter((o) => ["pending", "corrected"].includes(o.status));

  const exportBatch = useMutation(
    trpc.compliance.exportBatch.mutationOptions({
      onSuccess: async () => {
        setSelected(new Set());
        await queryClient.invalidateQueries({ queryKey: trpc.compliance.pathKey() });
      },
    }),
  );

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);

      if (!next.delete(id)) next.add(id);

      return next;
    });

  return (
    <Panel
      title="Obligations"
      flush
      action={
        selected.size > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={exportBatch.isPending}
            onClick={() => exportBatch.mutate({ obligationIds: [...selected] })}
          >
            {exportBatch.isPending && <Spinner />}
            Export {selected.size} for upload
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-(--card-p) py-3">
        <SegmentedControl
          label="Show"
          value={props.view}
          onValueChange={props.onView}
          options={VIEWS}
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
          <Select value={props.state} onValueChange={props.onState}>
            <SelectTrigger size="sm" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {props.states.map((s) => (
                <SelectItem key={s} value={s}>
                  {stateLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={props.kind} onValueChange={props.onKind}>
            <SelectTrigger size="sm" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All kinds</SelectItem>
              {["sl_filing", "sl_affidavit", "sl_remittance"].map((k) => (
                <SelectItem key={k} value={k}>
                  {kindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {exportBatch.error && (
        <Notice tone="error" title="Couldn't export" className="m-(--card-p)">
          {exportBatch.error.message}
        </Notice>
      )}
      {props.error ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="Couldn't load obligations"
          description={props.error}
        />
      ) : !props.loading && rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="Nothing here"
          description="Obligations appear as policies are issued."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all"
                  checked={selectable.length > 0 && selectable.every((o) => selected.has(o.id))}
                  onCheckedChange={(on) =>
                    setSelected(new Set(on ? selectable.map((o) => o.id) : []))
                  }
                />
              </TableHead>
              <TableHead>Obligation</TableHead>
              <TableHead className="hidden sm:table-cell">State</TableHead>
              <TableHead className="hidden lg:table-cell">Responsible</TableHead>
              <TableHead className="hidden sm:table-cell">Due</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.loading &&
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              ))}
            {rows.map((o) => (
              <TableRow
                key={o.id}
                className={cn(
                  "h-13 cursor-pointer hover:bg-muted/40",
                  selected.has(o.id) && "bg-primary/5",
                )}
                onClick={() =>
                  navigate({ to: "/compliance/$obligationId", params: { obligationId: o.id } })
                }
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {["pending", "corrected"].includes(o.status) && (
                    <Checkbox
                      aria-label={`Select ${o.title}`}
                      checked={selected.has(o.id)}
                      onCheckedChange={() => toggle(o.id)}
                    />
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Link
                    to="/compliance/$obligationId"
                    params={{ obligationId: o.id }}
                    className="grid gap-0.5 outline-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-sm leading-5 font-medium">{o.title}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {subjectLabel(o)}
                      {o.insuredName && ` · ${o.insuredName}`}
                    </span>
                    <span
                      className={cn(
                        "text-xs tabular-nums sm:hidden",
                        o.overdue ? "text-red-700" : "text-muted-foreground",
                      )}
                    >
                      Due {formatPlainDate(o.dueDate)}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {o.jurisdiction.replace(/^[A-Z]{2}-/, "")}
                </TableCell>
                <TableCell className="hidden max-w-48 truncate text-muted-foreground lg:table-cell">
                  {o.responsible.name}
                </TableCell>
                <TableCell
                  className={cn(
                    "hidden tabular-nums sm:table-cell",
                    o.overdue ? "text-red-700" : "text-muted-foreground",
                  )}
                >
                  {formatPlainDate(o.dueDate)}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <ObligationState obligation={o} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function Batches() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const batches = useQuery(trpc.compliance.batches.queryOptions());
  const [open, setOpen] = useState<string | null>(null);

  if (!batches.data?.length) return null;

  const download = async (batchId: string) =>
    downloadFile(await queryClient.fetchQuery(trpc.compliance.batchFile.queryOptions({ batchId })));

  return (
    <Panel
      title="Export batches"
      description="Files to upload to state portals, with what to do after."
      flush
    >
      <ul className="m-0 list-none divide-y p-0">
        {batches.data.slice(0, 8).map((batch) => (
          <li key={batch.id} className="px-(--card-p) py-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="grid min-w-0 gap-0.5 text-left outline-none"
                onClick={() => setOpen(open === batch.id ? null : batch.id)}
              >
                <span className="truncate text-sm leading-5 font-medium">{batch.fileName}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {batch.obligationIds.length}{" "}
                  {batch.obligationIds.length === 1 ? "filing" : "filings"} ·{" "}
                  {stateLabel(batch.jurisdiction)} · {formatDate(batch.createdAt)}
                </span>
              </button>
              <Button size="sm" variant="outline" onClick={() => download(batch.id)}>
                <Download /> Download
              </Button>
            </div>
            {open === batch.id && (
              <ol className="mt-3 mb-0 grid gap-1 pl-5 text-sm text-muted-foreground">
                {batch.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

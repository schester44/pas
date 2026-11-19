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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { jurisdictionShort } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { useState } from "react";
import {
  age,
  INSPECTION_TYPES,
  InspectionStatus,
  OWNERS,
  type ReferralSummary,
  ReferralStatus,
  SubjectivityStatus,
} from "@/components/underwriting/labels";
import { useEnvironment } from "@/lib/environment";
import { formatDate, formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Tab = "referrals" | "inspections" | "subjectivities";
type View = "open" | "mine" | "unassigned" | "escalated" | "waiting" | "decided";
const ALL = "*";

export const Route = createFileRoute("/_authed/underwriting/")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    search.tab === "inspections" || search.tab === "subjectivities" ? { tab: search.tab } : {},
  component: WorkbenchPage,
});

function WorkbenchPage() {
  const { tab = "referrals" } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Underwriting"
        actions={
          <SegmentedControl
            label="Work"
            value={tab}
            onValueChange={(next) =>
              void navigate({
                to: "/underwriting",
                search: next === "referrals" ? {} : { tab: next },
              })
            }
            options={[
              { value: "referrals", label: "Referrals" },
              { value: "inspections", label: "Inspections" },
              { value: "subjectivities", label: "Subjectivities" },
            ]}
          />
        }
      />
      <PageBody className="gap-6">
        {tab === "referrals" && <Queue />}
        {tab === "inspections" && <Inspections />}
        {tab === "subjectivities" && <Subjectivities />}
      </PageBody>
    </>
  );
}

const VIEWS: { value: View; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "escalated", label: "Escalated" },
  { value: "waiting", label: "Waiting on producer" },
  { value: "decided", label: "Decided" },
];

const AGES = [
  { value: ALL, label: "Any age" },
  { value: "24", label: "Older than 1 day" },
  { value: "72", label: "Older than 3 days" },
];

function Queue() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const now = useEnvironment().data?.now;
  const [view, setView] = useState<View>("open");
  const [product, setProduct] = useState(ALL);
  const [state, setState] = useState(ALL);
  const [older, setOlder] = useState(ALL);

  const queue = useQuery(
    trpc.underwriting.queue.queryOptions({
      view,
      ...(product !== ALL && { productId: product }),
      ...(state !== ALL && { jurisdiction: state }),
      ...(older !== ALL && { olderThanHours: Number(older) }),
    }),
  );

  const everything = useQuery(trpc.underwriting.queue.queryOptions({ view: "open" }));
  const known = [...(everything.data?.items ?? []), ...(queue.data?.items ?? [])];
  const products = new Map(known.map((r) => [r.productId, r.productName]));
  const states = [...new Set(known.map((r) => r.jurisdiction))].toSorted();
  const counts = queue.data?.counts;
  const rows = queue.data?.items ?? [];
  const me = queue.data?.me.profile;

  const open = (r: ReferralSummary) =>
    navigate({ to: "/underwriting/referrals/$referralId", params: { referralId: r.id } });

  return (
    <Panel
      flush
      title="Referral queue"
      description={
        me
          ? `Your authority: ${me.name}.`
          : "You don't hold an underwriting authority, so you can review but not approve."
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-(--card-p) py-3">
        <SegmentedControl
          label="Show"
          value={view}
          onValueChange={setView}
          options={VIEWS.map((v) => ({
            value: v.value,
            label: (
              <>
                {v.label}
                {counts && v.value !== "decided" && counts[v.value] > 0 && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {counts[v.value]}
                  </span>
                )}
              </>
            ),
          }))}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Select value={product} onValueChange={setProduct}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All products</SelectItem>
              {[...products].map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/^US-/, "")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={older} onValueChange={setOlder}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {queue.error ? (
        <div className="p-(--card-p)">
          <Notice tone="error" title="Couldn't load the queue">
            {queue.error.message}
          </Notice>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={queue.isPending ? "Loading…" : "Nothing here"}
          description={
            queue.isPending ? undefined : "Referred quotes show up here as the rules refer them."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submission</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Needs</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead className="text-right">Premium</TableHead>
              <TableHead className="text-right">Review by</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => void open(r)}
              >
                <TableCell>
                  <Link
                    to="/underwriting/referrals/$referralId"
                    params={{ referralId: r.id }}
                    className="grid gap-0.5 outline-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="font-medium tabular-nums">{r.submissionNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.insuredName ?? "Unnamed insured"} · {r.productName} ·{" "}
                      {jurisdictionShort({
                        country: r.jurisdiction.slice(0, 2),
                        subdivision: r.jurisdiction,
                      })}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="max-w-64">
                  <span className="line-clamp-2 text-sm">
                    {r.reasons[0]?.message}
                    {r.reasons.length > 1 && (
                      <span className="text-muted-foreground"> +{r.reasons.length - 1}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{r.requiredAuthority ?? "–"}</TableCell>
                <TableCell className={cn("text-sm", !r.assignee && "text-muted-foreground")}>
                  {r.assignee?.name ?? "Unassigned"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(r.writtenPremium.amount, r.writtenPremium.currency)}
                </TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", r.overdue && "font-medium text-red-700")}
                >
                  {formatDate(r.dueAt)}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {now ? age(r.openedAt, now) : "–"}
                </TableCell>
                <TableCell>
                  <ReferralStatus status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function Inspections() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [view, setView] = useState<"review" | "pending" | "done" | "all">("review");
  const list = useQuery(trpc.underwriting.inspections.list.queryOptions({ view }));
  const rows = list.data ?? [];

  return (
    <Panel
      flush
      title="Inspections"
      description="Every report gets a person's review; findings never decline a risk on their own."
    >
      <div className="border-b px-(--card-p) py-3">
        <SegmentedControl
          label="Show"
          value={view}
          onValueChange={setView}
          options={[
            { value: "review", label: "Needs review" },
            { value: "pending", label: "With the vendor" },
            { value: "done", label: "Reviewed" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={list.isPending ? "Loading…" : "Nothing here"}
          description={list.isPending ? undefined : "Inspections the rules order show up here."}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Inspection</TableHead>
              <TableHead>Property</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead className="text-right">Findings</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow
                key={i.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() =>
                  void navigate({
                    to: "/underwriting/inspections/$inspectionId",
                    params: { inspectionId: i.id },
                  })
                }
              >
                <TableCell>
                  <span className="grid gap-0.5">
                    <span className="font-medium">{INSPECTION_TYPES[i.type] ?? i.type}</span>
                    <span className="text-xs text-muted-foreground">{i.reason}</span>
                  </span>
                </TableCell>
                <TableCell className="max-w-56 truncate text-sm">{i.address}</TableCell>
                <TableCell className="tabular-nums">
                  {i.policyNumber ?? i.submissionNumber}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {i.report ? (
                    i.report.findings.length
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(i.history.at(-1)?.at ?? i.createdAt)}
                </TableCell>
                <TableCell>
                  <InspectionStatus status={i.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function Subjectivities() {
  const trpc = useTRPC();
  const list = useQuery(trpc.underwriting.subjectivities.open.queryOptions());
  const rows = list.data ?? [];

  return (
    <Panel flush title="Open subjectivities" description="Overdue first, then by due date.">
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={list.isPending ? "Loading…" : "Nothing open"}
          description={
            list.isPending ? undefined : "Subjectivities on quotes and policies show up here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subjectivity</TableHead>
              <TableHead>On</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <span className="grid gap-0.5">
                    <span className="font-medium">{s.title}</span>
                    {s.overdue && s.consequence && (
                      <span className="text-xs text-red-700">{s.consequence}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {s.policyId ? (
                    <Link
                      to="/policies/$policyId"
                      params={{ policyId: s.policyId }}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.policyNumber}
                    </Link>
                  ) : (
                    <Link
                      to="/submissions/$submissionId"
                      params={{ submissionId: s.submissionId }}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.submissionNumber}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-sm">{OWNERS[s.owner] ?? s.owner}</TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", s.overdue && "font-medium text-red-700")}
                >
                  {s.dueDate ? formatPlainDate(s.dueDate) : "Before binding"}
                </TableCell>
                <TableCell>
                  <SubjectivityStatus status={s.status} overdue={s.overdue} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

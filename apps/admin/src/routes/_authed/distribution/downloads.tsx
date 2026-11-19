import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Label } from "@pas/ui/components/label";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileCode, Inbox, Send } from "lucide-react";
import { useState } from "react";
import { BatchSheet } from "@/components/agency-downloads/batch-sheet";
import {
  BatchStatus,
  type DownloadBatch,
  type DownloadItem,
  type DownloadsOverview,
  type DownloadsProvider,
  FORMAT_LABELS,
  ItemStatus,
  KIND_LABELS,
  mailboxOf,
  saveFile,
  TRIGGER_LABELS,
} from "@/components/agency-downloads/shared";
import { useEnvironment } from "@/lib/environment";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

const TABS = ["waiting", "delivered", "files", "mailboxes", "harness"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authed/distribution/downloads")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search.tab as Tab) && search.tab !== "waiting" ? { tab: search.tab as Tab } : {},
  component: DownloadsPage,
});

function DownloadsPage() {
  const trpc = useTRPC();
  const { tab = "waiting" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const overview = useQuery(trpc.agencyDownloads.overview.queryOptions());
  const [batchId, setBatchId] = useState<string | null>(null);
  const data = overview.data;

  return (
    <>
      <PageHeader
        title="Agency downloads"
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings/integrations/$providerId" params={{ providerId: "ivans_download" }}>
              Settings
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-6xl">
        {overview.error ? (
          <Notice tone="error" title="Couldn't load downloads">
            {overview.error.message}
          </Notice>
        ) : !data ? (
          <>
            <div className="h-28 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
          </>
        ) : (
          <>
            <ProviderSummary provider={data.provider} data={data} />
            <div className="grid gap-4">
              <SegmentedControl
                label="Download sections"
                value={tab}
                className="w-fit"
                onValueChange={(next) =>
                  navigate({ search: next === "waiting" ? {} : { tab: next }, resetScroll: false })
                }
                options={[
                  { value: "waiting", label: `Waiting ${data.pending.length}` },
                  { value: "delivered", label: "Delivered" },
                  { value: "files", label: "Files" },
                  { value: "mailboxes", label: `Mailboxes ${data.mailboxes.length}` },
                  { value: "harness", label: "Test harness" },
                ]}
              />
              {tab === "waiting" && <WaitingPanel items={data.pending} provider={data.provider} />}
              {tab === "delivered" && <DeliveredPanel items={data.delivered} onOpen={setBatchId} />}
              {tab === "files" && <FilesPanel batches={data.batches} onOpen={setBatchId} />}
              {tab === "mailboxes" && <MailboxesPanel mailboxes={data.mailboxes} />}
              {tab === "harness" && (
                <HarnessPanel mailboxes={data.mailboxes} provider={data.provider} />
              )}
            </div>
          </>
        )}
        <BatchSheet batchId={batchId} onOpenChange={(open) => !open && setBatchId(null)} />
      </PageBody>
    </>
  );
}

function ProviderSummary({
  provider,
  data,
}: {
  provider: DownloadsProvider | null;
  data: DownloadsOverview;
}) {
  if (!provider) {
    return (
      <Panel>
        <EmptyState
          icon={<Inbox />}
          title="Agency downloads are off"
          description="Enable IVANS Download to send enrolled agencies their policies, documents and commission statements each night."
          action={
            <Button size="sm" asChild>
              <Link
                to="/settings/integrations/$providerId"
                params={{ providerId: "ivans_download" }}
              >
                Set up IVANS Download
              </Link>
            </Button>
          }
        />
      </Panel>
    );
  }

  const delivered = data.batches.filter((b) => b.status === "delivered").length;
  const failed = data.batches.filter((b) => b.status === "failed").length;

  return (
    <Panel>
      <div className="grid gap-5">
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Fact label="Next batch">
            <span className="tabular-nums">{formatDateTime(provider.nextRunAt)}</span>
          </Fact>
          <Fact label="Delivers to">
            {provider.transport === "test_mailbox" ? "Test mailbox" : "IVANS network"}
          </Fact>
          <Fact label="Format">{FORMAT_LABELS[provider.format] ?? provider.format}</Fact>
          <Fact label="Files">
            <span className="tabular-nums">
              {delivered} delivered{failed > 0 && `, ${failed} failed`}
            </span>
          </Fact>
        </dl>
        <p className="m-0 text-sm text-muted-foreground">
          Sends {provider.transactionKinds.map((k) => KIND_LABELS[k]).join(", ")}
          {provider.commissionStatements && ", and monthly commission statements"}
          {provider.documents && ", with documents attached"}, nightly at {provider.batchTime} (
          {provider.timeZone}).
        </p>
        {!provider.certified && (
          <p className="m-0 flex items-center gap-2 text-sm text-amber-800">
            <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
            This file format isn't certified with IVANS yet. Use the test harness to prepare
            certification files.
          </p>
        )}
      </div>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm font-medium">{children}</dd>
    </div>
  );
}

function ItemRow({ item, action }: { item: DownloadItem; action?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 px-(--card-p) py-3">
      <span className="grid min-w-0 gap-0.5">
        <span className="truncate text-sm leading-5 font-medium tabular-nums">
          {item.policyId ? (
            <Link
              to="/policies/$policyId"
              params={{ policyId: item.policyId }}
              className="hover:underline"
            >
              {item.title}
            </Link>
          ) : (
            item.title
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {[
            item.agencyName,
            item.effectiveDate && `Effective ${formatPlainDate(item.effectiveDate)}`,
            item.deliveredAt
              ? `Delivered ${formatDateTime(item.deliveredAt)}`
              : `Queued ${formatDateTime(item.createdAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {item.lastError && item.status === "pending" && (
          <span className="text-xs text-red-800">{item.lastError}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {action}
        <ItemStatus item={item} />
      </span>
    </li>
  );
}

function WaitingPanel({
  items,
  provider,
}: {
  items: DownloadItem[];
  provider: DownloadsProvider | null;
}) {
  return (
    <Panel flush>
      {items.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Nothing waiting"
          description={
            provider
              ? "Transactions issued for enrolled agencies wait here until the next batch."
              : "Nothing is queued while agency downloads are off."
          }
        />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DeliveredPanel({
  items,
  onOpen,
}: {
  items: DownloadItem[];
  onOpen: (batchId: string) => void;
}) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();

  const resend = useMutation(
    trpc.agencyDownloads.resendItem.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.agencyDownloads.pathKey() }),
    }),
  );

  return (
    <Panel flush>
      {resend.error && (
        <Notice tone="error" title="Couldn't resend" className="m-(--card-p)">
          {resend.error.message}
        </Notice>
      )}
      {items.length === 0 ? (
        <EmptyState title="Nothing delivered yet" />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              action={
                <>
                  {item.batchId && (
                    <Button size="sm" variant="ghost" onClick={() => onOpen(item.batchId!)}>
                      View file
                    </Button>
                  )}
                  {access.agencies.write && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resend.isPending}
                      onClick={() => resend.mutate({ itemId: item.id })}
                    >
                      {resend.isPending && resend.variables?.itemId === item.id && <Spinner />}
                      Resend
                    </Button>
                  )}
                </>
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FilesPanel({
  batches,
  onOpen,
}: {
  batches: DownloadBatch[];
  onOpen: (batchId: string) => void;
}) {
  return (
    <Panel flush>
      {batches.length === 0 ? (
        <EmptyState icon={<FileCode />} title="No files yet" />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {batches.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onOpen(b.id)}
                className="flex w-full items-center justify-between gap-4 px-(--card-p) py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate font-mono text-sm leading-5">{b.fileName}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {[
                      b.agencyName,
                      mailboxOf(b),
                      b.kind === "commission_statement" ? "Commission statement" : null,
                      `${b.itemCount} ${b.itemCount === 1 ? "item" : "items"}`,
                      TRIGGER_LABELS[b.trigger],
                      formatDateTime(b.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {b.error && <span className="truncate text-xs text-red-800">{b.error}</span>}
                </span>
                <BatchStatus status={b.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function lastMonth(now: string) {
  const [year, month] = now.slice(0, 7).split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(year, month - 2, 1));
  const end = new Date(Date.UTC(year, month - 1, 0));

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function MailboxesPanel({ mailboxes }: { mailboxes: DownloadsOverview["mailboxes"] }) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const now = useEnvironment().data?.now;
  const period = now ? lastMonth(now) : null;

  const send = useMutation(
    trpc.agencyDownloads.sendStatement.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.agencyDownloads.pathKey() }),
    }),
  );

  return (
    <Panel
      flush
      title="Enrolled agencies"
      description="Enroll an agency on its page under Downloads."
    >
      {send.error && (
        <Notice tone="error" title="Couldn't send the statement" className="m-(--card-p)">
          {send.error.message}
        </Notice>
      )}
      {mailboxes.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No agencies enrolled"
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/agencies">Open agencies</Link>
            </Button>
          }
        />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {mailboxes.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-4 px-(--card-p) py-3">
              <span className="grid min-w-0 gap-0.5">
                <Link
                  to="/agencies/$agencyId"
                  params={{ agencyId: m.agencyId }}
                  search={{ tab: "downloads" }}
                  className="truncate text-sm leading-5 font-medium hover:underline"
                >
                  {m.agencyName}
                </Link>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {[
                    mailboxOf(m),
                    m.agencyCodes.map((c) => c.code).join(", "),
                    `${m.files} ${m.files === 1 ? "file" : "files"}`,
                    m.pending > 0 && `${m.pending} waiting`,
                    m.lastDeliveredAt && `Last ${formatDateTime(m.lastDeliveredAt)}`,
                    !m.enabled && "Paused",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {access.agencies.write && period && m.enabled && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={send.isPending}
                  onClick={() => send.mutate({ agencyId: m.agencyId, ...period })}
                >
                  {send.isPending && send.variables?.agencyId === m.agencyId ? (
                    <Spinner />
                  ) : (
                    <Send />
                  )}
                  Send {formatPlainDate(period.from).replace(/ \d+,/, "")} statement
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HarnessPanel({
  mailboxes,
  provider,
}: {
  mailboxes: DownloadsOverview["mailboxes"];
  provider: DownloadsProvider | null;
}) {
  const trpc = useTRPC();
  const lines = useQuery(trpc.agencyDownloads.linesOfBusiness.queryOptions());
  const [format, setFormat] = useState<"acord_xml" | "al3">(provider?.format ?? "acord_xml");
  const [line, setLine] = useState<string>("");
  const [agencyId, setAgencyId] = useState<string>("sample");
  const [open, setOpen] = useState<string | null>(null);
  const generate = useMutation(trpc.agencyDownloads.samples.mutationOptions());
  const lineOfBusiness = line || lines.data?.[0] || "";

  return (
    <Panel
      title="Certification samples"
      description="Builds one file per scenario on a sample policy through the live mapping, to send IVANS during certification."
      footer={
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={generate.isPending || !lineOfBusiness}
            onClick={() =>
              generate.mutate({
                format,
                lineOfBusiness,
                ...(agencyId !== "sample" && { agencyId }),
              })
            }
          >
            {generate.isPending && <Spinner />}
            Generate samples
          </Button>
        </div>
      }
    >
      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="sample-format">Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger id="sample-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="acord_xml">ACORD XML</SelectItem>
                <SelectItem value="al3">ACORD AL3 (placeholder)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sample-line">Line of business</Label>
            <Select value={lineOfBusiness} onValueChange={setLine}>
              <SelectTrigger id="sample-line">
                <SelectValue placeholder="No products yet" />
              </SelectTrigger>
              <SelectContent>
                {(lines.data ?? []).map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sample-agency">Agency</Label>
            <Select value={agencyId} onValueChange={setAgencyId}>
              <SelectTrigger id="sample-agency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sample">Sample agency</SelectItem>
                {mailboxes.map((m) => (
                  <SelectItem key={m.agencyId} value={m.agencyId}>
                    {m.agencyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {generate.error && (
          <Notice tone="error" title="Couldn't generate samples">
            {generate.error.message}
          </Notice>
        )}
        {generate.data && (
          <ul className="m-0 grid list-none gap-3 p-0">
            {generate.data.map((file) => (
              <li key={file.scenario} className="grid gap-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm leading-5 font-medium">{file.label}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {file.fileName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpen(open === file.scenario ? null : file.scenario)}
                    >
                      {open === file.scenario ? "Hide" : "Preview"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveFile(file.fileName, file.contentType, file.content)}
                    >
                      <Download /> Download
                    </Button>
                  </span>
                </div>
                {file.issues.length > 0 && (
                  <p className="m-0 text-xs text-red-800">{file.issues.join("; ")}</p>
                )}
                {open === file.scenario && (
                  <pre className="m-0 max-h-[50vh] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-5">
                    {file.content}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

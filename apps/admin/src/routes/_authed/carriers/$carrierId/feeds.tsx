import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
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
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Field } from "@/components/distribution/agency-dialog";
import { formatDate, formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/$carrierId/feeds")({
  component: FeedsTab,
});

type Feed = AdminOutputs["carriers"]["feeds"]["list"][number];

const FORMATS = { bordereaux_csv: "Bordereaux (CSV)", acord_xml: "ACORD-style XML" } as const;
const SCHEDULES = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" } as const;

function FeedsTab() {
  const { carrierId } = Route.useParams();
  const trpc = useTRPC();
  const feeds = useQuery(trpc.carriers.feeds.list.queryOptions({ carrierId }));

  return (
    <PageBody className="max-w-6xl">
      {(feeds.data ?? []).map((feed) => (
        <FeedPanel key={feed.id} carrierId={carrierId} feed={feed} />
      ))}
      <FeedPanel key={`new-${feeds.data?.length ?? 0}`} carrierId={carrierId} feed={null} />
    </PageBody>
  );
}

function FeedPanel({ carrierId, feed }: { carrierId: string; feed: Feed | null }) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();

  const [values, setValues] = useState({
    name: feed?.name ?? "",
    format: feed?.format ?? ("bordereaux_csv" as Feed["format"]),
    channel: feed?.channel ?? ("sftp" as Feed["channel"]),
    destination: feed?.destination ?? { host: "", path: "/inbound" },
    schedule: feed?.schedule ?? ("monthly" as Feed["schedule"]),
    status: feed?.status ?? ("active" as Feed["status"]),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.carriers.feeds.list.queryKey({ carrierId }) });

  const save = useMutation(trpc.carriers.feeds.save.mutationOptions({ onSuccess: refresh }));
  const run = useMutation(trpc.carriers.feeds.run.mutationOptions({ onSuccess: refresh }));
  const [viewing, setViewing] = useState<string | null>(null);

  const file = useQuery({
    ...trpc.carriers.feeds.download.queryOptions({
      feedId: feed?.id ?? "",
      deliveryId: viewing ?? "",
    }),
    enabled: !!feed && !!viewing,
  });

  const readOnly = !access.products.write;
  const id = (name: string) => `${feed?.id ?? "new"}-${name}`;

  return (
    <Panel
      title={feed ? feed.name : "New file feed"}
      description={
        feed
          ? `${FORMATS[feed.format]} by ${feed.channel === "sftp" ? "SFTP" : "email"}, ${SCHEDULES[feed.schedule].toLowerCase()}${feed.lastRunAt ? ` · last sent ${formatDate(feed.lastRunAt)}` : ""}`
          : "For carriers without an API: PAS stays system of record and sends issued transactions on a schedule."
      }
      action={
        feed && (
          <StatusChip tone={feed.status === "active" ? "success" : "neutral"}>
            {feed.status === "active" ? "Active" : "Paused"}
          </StatusChip>
        )
      }
      footer={
        !readOnly && (
          <div className="flex items-center justify-end gap-2">
            {(save.error ?? run.error) && (
              <span className="text-xs text-red-700">{(save.error ?? run.error)?.message}</span>
            )}
            {run.data && (
              <span className="truncate text-xs text-muted-foreground">
                {run.data.records} record{run.data.records === 1 ? "" : "s"} sent
              </span>
            )}
            {feed && (
              <Button
                size="sm"
                variant="outline"
                disabled={run.isPending}
                onClick={() => run.mutate({ feedId: feed.id })}
              >
                {run.isPending && <Spinner />}
                Send now
              </Button>
            )}
            <Button
              size="sm"
              disabled={save.isPending || !values.name.trim()}
              onClick={() => save.mutate({ ...values, carrierId, ...(feed && { id: feed.id }) })}
            >
              {save.isPending && <Spinner />}
              {feed ? "Save feed" : "Create feed"}
            </Button>
          </div>
        )
      }
    >
      <div className="grid min-w-0 gap-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Name" id={id("name")}>
            <Input
              id={id("name")}
              value={values.name}
              readOnly={readOnly}
              placeholder="Monthly bordereau"
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
          </Field>
          <Field label="Format" id={id("format")}>
            <Select
              value={values.format}
              onValueChange={(v) => setValues({ ...values, format: v as Feed["format"] })}
              disabled={readOnly}
            >
              <SelectTrigger id={id("format")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FORMATS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Schedule" id={id("schedule")}>
            <Select
              value={values.schedule}
              onValueChange={(v) => setValues({ ...values, schedule: v as Feed["schedule"] })}
              disabled={readOnly}
            >
              <SelectTrigger id={id("schedule")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SCHEDULES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" id={id("status")}>
            <Select
              value={values.status}
              onValueChange={(v) => setValues({ ...values, status: v as Feed["status"] })}
              disabled={readOnly}
            >
              <SelectTrigger id={id("status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Delivered by" id={id("channel")}>
            <Select
              value={values.channel}
              onValueChange={(v) => setValues({ ...values, channel: v as Feed["channel"] })}
              disabled={readOnly}
            >
              <SelectTrigger id={id("channel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sftp">SFTP</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {values.channel === "sftp" ? (
            <>
              <Field label="Host" id={id("host")}>
                <Input
                  id={id("host")}
                  value={values.destination.host ?? ""}
                  readOnly={readOnly}
                  placeholder="sftp.carrier.com"
                  onChange={(e) =>
                    setValues({
                      ...values,
                      destination: { ...values.destination, host: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Folder" id={id("path")}>
                <Input
                  id={id("path")}
                  value={values.destination.path ?? ""}
                  readOnly={readOnly}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      destination: { ...values.destination, path: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Username" id={id("user")} optional>
                <Input
                  id={id("user")}
                  value={values.destination.username ?? ""}
                  readOnly={readOnly}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      destination: { ...values.destination, username: e.target.value },
                    })
                  }
                />
              </Field>
            </>
          ) : (
            <Field label="Send to" id={id("email")}>
              <Input
                id={id("email")}
                type="email"
                value={values.destination.email ?? ""}
                readOnly={readOnly}
                onChange={(e) =>
                  setValues({
                    ...values,
                    destination: { ...values.destination, email: e.target.value },
                  })
                }
              />
            </Field>
          )}
        </div>
        {feed && (
          <div className="-mx-(--card-p) min-w-0 overflow-hidden border-t">
            {feed.deliveries.length === 0 ? (
              <EmptyState
                title="Nothing sent yet"
                description="Deliveries are logged here with what was sent."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feed.deliveries.map((d) => (
                    <TableRow
                      key={d.id}
                      className="h-12 cursor-pointer hover:bg-muted/40"
                      onClick={() => setViewing(viewing === d.id ? null : d.id)}
                    >
                      <TableCell className="tabular-nums">
                        {formatPlainDate(d.periodFrom)} – {formatPlainDate(d.periodTo)}
                      </TableCell>
                      <TableCell className="max-w-72 truncate font-mono text-xs" title={d.fileName}>
                        {d.fileName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{d.records}</TableCell>
                      <TableCell>
                        <span title={d.detail ?? undefined}>
                          <StatusChip tone={d.status === "delivered" ? "success" : "danger"}>
                            {d.status === "delivered"
                              ? `Delivered by ${d.channel === "sftp" ? "SFTP" : "email"}`
                              : "Failed"}
                          </StatusChip>
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatDate(d.deliveredAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {viewing && file.data && (
              <pre className="m-0 max-h-72 overflow-auto border-t bg-muted/30 px-(--card-p) py-3 font-mono text-[11px] leading-4">
                {file.data.text}
              </pre>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

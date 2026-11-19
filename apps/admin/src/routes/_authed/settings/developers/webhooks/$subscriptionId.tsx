import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Label } from "@pas/ui/components/label";
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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Ellipsis, Inbox } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import {
  Code,
  DELIVERY_STATUS,
  describePatterns,
  draftOf,
  SecretReveal,
  SubscriptionForm,
  useEventCatalog,
} from "@/components/events/subscriptions";
import { formatDateTime } from "@/lib/environment";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/developers/webhooks/$subscriptionId")({
  component: WebhookPage,
});

type Detail = AdminOutputs["events"]["subscriptions"]["get"];

function WebhookPage() {
  const { subscriptionId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const catalog = useEventCatalog();
  const [dialog, setDialog] = useState<"edit" | "test" | "delete" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [openDelivery, setOpenDelivery] = useState<string | null>(null);

  const detail = useQuery({
    ...trpc.events.subscriptions.get.queryOptions({ id: subscriptionId }),
    refetchInterval: (query) =>
      query.state.data?.deliveries.some((d) => d.status === "pending" || d.status === "retrying")
        ? 3000
        : false,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.events.subscriptions.pathKey() });

  const setStatus = useMutation(
    trpc.events.subscriptions.setStatus.mutationOptions({ onSuccess: refresh }),
  );

  const rotate = useMutation(
    trpc.events.subscriptions.rotateSecret.mutationOptions({
      onSuccess: async (result) => {
        await refresh();
        setSecret(result.secret);
      },
    }),
  );

  const subscription = detail.data?.subscription;

  return (
    <>
      <PageHeader
        title={subscription?.name ?? "Webhook"}
        actions={
          subscription && (
            <>
              <Button
                variant="outline"
                disabled={subscription.status === "disabled"}
                onClick={() => setDialog("test")}
              >
                Send test event
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => rotate.mutate({ id: subscription.id })}>
                    Rotate secret
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      setStatus.mutate({
                        id: subscription.id,
                        active: subscription.status === "disabled",
                      })
                    }
                  >
                    {subscription.status === "disabled" ? "Enable" : "Disable"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setDialog("delete")}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      />
      <PageBody className="max-w-4xl">
        {detail.error && (
          <Notice tone="error" title="Couldn't load the webhook">
            {detail.error.message}
          </Notice>
        )}
        {rotate.error && (
          <Notice tone="error" title="Couldn't rotate the secret">
            {rotate.error.message}
          </Notice>
        )}
        {subscription?.status === "disabled" && (
          <Notice tone="warning" title="Disabled">
            {subscription.disabledReason ?? "Turned off by hand."} New events aren't sent here until
            you enable it; replay any deliveries you need.
          </Notice>
        )}
        {!detail.data ? (
          <div className="grid gap-6">
            <div className="h-56 animate-pulse rounded-xl border bg-card" />
            <div className="h-72 animate-pulse rounded-xl border bg-card" />
          </div>
        ) : (
          <>
            <Panel title="Endpoint" flush>
              <dl className="m-0 divide-y">
                <Row label="URL">
                  <span className="font-mono text-[13px] break-all">{subscription!.url}</span>
                </Row>
                <Row label="Events">
                  {describePatterns(subscription!.eventTypes, catalog.data?.types ?? [])}
                </Row>
                <Row label="Filter">
                  {subscription!.filter ? (
                    <code className="font-mono text-[13px]">{subscription!.filter}</code>
                  ) : (
                    <span className="text-muted-foreground">Every matching event</span>
                  )}
                </Row>
                <Row label="Signing secret">
                  <span className="font-mono text-[13px]">{subscription!.secretHint}</span>
                </Row>
                <Row label="Status">
                  <HealthLine subscription={subscription!} />
                </Row>
              </dl>
            </Panel>
            <Deliveries
              deliveries={detail.data.deliveries}
              titles={catalog.data?.types ?? []}
              onOpen={setOpenDelivery}
            />
          </>
        )}
      </PageBody>
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className={dialog === "edit" ? "sm:max-w-xl" : "sm:max-w-md"}>
          {subscription && dialog === "edit" && (
            <SubscriptionForm
              kind="webhook"
              initial={draftOf(subscription)}
              onDone={async () => {
                await refresh();
                setDialog(null);
              }}
            />
          )}
          {subscription && dialog === "test" && (
            <SendTest
              subscription={subscription}
              onSent={async (deliveryId) => {
                await refresh();
                setDialog(null);
                setOpenDelivery(deliveryId);
              }}
            />
          )}
          {subscription && dialog === "delete" && (
            <DeleteWebhook
              subscription={subscription}
              onDeleted={() => navigate({ to: "/settings/developers/webhooks" })}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent className="sm:max-w-lg">
          {secret && <SecretReveal secret={secret} rotated />}
        </DialogContent>
      </Dialog>
      <DeliverySheet id={openDelivery} onClose={() => setOpenDelivery(null)} onReplayed={refresh} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-(--card-p) py-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

function HealthLine({ subscription }: { subscription: Detail["subscription"] }) {
  if (subscription.status === "disabled") return <StatusChip tone="danger">Disabled</StatusChip>;

  if (subscription.failingSince) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <StatusChip tone="warning">Failing</StatusChip>
        <span className="text-muted-foreground">
          No successful delivery since {formatDateTime(subscription.failingSince)}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusChip tone="success">Active</StatusChip>
      {subscription.lastSuccessAt && (
        <span className="text-muted-foreground">
          Last delivered {formatRelative(subscription.lastSuccessAt)}
        </span>
      )}
    </span>
  );
}

function Deliveries({
  deliveries,
  titles,
  onOpen,
}: {
  deliveries: Detail["deliveries"];
  titles: { type: string; title: string }[];
  onOpen: (id: string) => void;
}) {
  return (
    <Panel title="Deliveries" description="The last 100, newest first." flush>
      {deliveries.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="Nothing delivered yet"
          description="Send a test event, or wait for the next matching event."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead className="text-right">Response</TableHead>
              <TableHead className="text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => {
              const status = DELIVERY_STATUS[d.status] ?? DELIVERY_STATUS.pending!;

              return (
                <TableRow
                  key={d.id}
                  tabIndex={0}
                  className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  onClick={() => onOpen(d.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpen(d.id)}
                >
                  <TableCell>
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {titles.find((t) => t.type === d.eventType)?.title ?? d.eventType}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{d.eventType}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      {d.status === "retrying" && d.nextAttemptAt && (
                        <span className="text-xs text-muted-foreground">
                          next {formatRelative(d.nextAttemptAt)}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.attempts}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {d.lastStatusCode ?? <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatDateTime(d.createdAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function DeliverySheet({
  id,
  onClose,
  onReplayed,
}: {
  id: string | null;
  onClose: () => void;
  onReplayed: () => Promise<unknown>;
}) {
  const trpc = useTRPC();

  const detail = useQuery({
    ...trpc.events.subscriptions.delivery.queryOptions({ id: id ?? "" }),
    enabled: id !== null,
    refetchInterval: (query) =>
      ["pending", "retrying"].includes(query.state.data?.delivery.status ?? "") ? 2000 : false,
  });

  const replay = useMutation(
    trpc.events.subscriptions.replay.mutationOptions({
      onSuccess: async () => {
        await onReplayed();
        setTimeout(() => void detail.refetch(), 1200);
      },
    }),
  );

  const data = detail.data;
  const status = data && (DELIVERY_STATUS[data.delivery.status] ?? DELIVERY_STATUS.pending!);

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">{data?.event?.type ?? "Delivery"}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{data?.event?.id}</SheetDescription>
          {data && status && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <StatusChip tone={status.tone}>{status.label}</StatusChip>
                {data.event?.test && <StatusChip tone="accent">Test</StatusChip>}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={replay.isPending}
                onClick={() => id && replay.mutate({ deliveryId: id })}
              >
                {replay.isPending && <Spinner />}
                Replay
              </Button>
            </div>
          )}
        </SheetHeader>
        <SheetBody>
          {replay.error && (
            <Notice tone="error" title="Couldn't replay">
              {replay.error.message}
            </Notice>
          )}
          {!data ? (
            <div className="h-64 animate-pulse rounded-lg bg-muted/40" />
          ) : (
            <>
              <section className="grid gap-3">
                <h3 className="m-0 text-sm font-semibold">Attempts</h3>
                {data.attempts.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">
                    Waiting for the first attempt.
                  </p>
                ) : (
                  <ol className="m-0 grid list-none gap-3 p-0">
                    {data.attempts.map((a) => (
                      <li key={a.id} className="grid gap-2 rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2">
                            <span className="font-medium tabular-nums">Attempt {a.attempt}</span>
                            {a.trigger !== "automatic" && (
                              <span className="text-xs text-muted-foreground">{a.trigger}</span>
                            )}
                          </span>
                          <span className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                            <span
                              className={
                                a.statusCode && a.statusCode < 300
                                  ? "font-mono text-emerald-700"
                                  : "font-mono text-red-700"
                              }
                            >
                              {a.statusCode ?? "no response"}
                            </span>
                            <span>{a.durationMs} ms</span>
                            <span>{formatDateTime(a.attemptedAt)}</span>
                          </span>
                        </div>
                        {a.error && a.error !== `HTTP ${a.statusCode}` && (
                          <p className="m-0 text-xs text-red-800">{a.error}</p>
                        )}
                        {a.responseBody && <Code>{a.responseBody}</Code>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              {data.attempts[0] && (
                <section className="grid gap-2">
                  <h3 className="m-0 text-sm font-semibold">Request headers</h3>
                  <Code>
                    {[
                      `POST ${data.attempts[0].request.url}`,
                      ...Object.entries(data.attempts[0].request.headers).map(
                        ([k, v]) => `${k}: ${v}`,
                      ),
                    ].join("\n")}
                  </Code>
                </section>
              )}
              {data.event && (
                <section className="grid gap-2">
                  <h3 className="m-0 text-sm font-semibold">Payload</h3>
                  <Code>{JSON.stringify(data.event.envelope, null, 2)}</Code>
                </section>
              )}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function SendTest({
  subscription,
  onSent,
}: {
  subscription: Detail["subscription"];
  onSent: (deliveryId: string) => void;
}) {
  const trpc = useTRPC();
  const catalog = useEventCatalog();

  const types = (catalog.data?.types ?? []).filter((t) =>
    subscription.eventTypes.some(
      (p) => p === "*" || p === t.type || (p.endsWith(".*") && t.type.startsWith(p.slice(0, -1))),
    ),
  );

  const [type, setType] = useState("");
  const chosen = type || types[0]?.type || "";

  const send = useMutation(
    trpc.events.subscriptions.sendTest.mutationOptions({
      onSuccess: (result) => onSent(result.deliveryId),
    }),
  );

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate({ id: subscription.id, type: chosen });
      }}
    >
      <DialogHeader>
        <DialogTitle>Send test event</DialogTitle>
        <DialogDescription>
          Sends the catalog's sample payload, marked <code>"test": true</code>, to this endpoint
          only.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="test-type">Event</Label>
        <Select value={chosen} onValueChange={setType}>
          <SelectTrigger id="test-type">
            <SelectValue placeholder="Choose an event" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {types.map((t) => (
              <SelectItem key={t.type} value={t.type}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {send.error && (
        <Notice tone="error" title="Couldn't send">
          {send.error.message}
        </Notice>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!chosen || send.isPending}>
          {send.isPending && <Spinner />}
          Send test event
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteWebhook({
  subscription,
  onDeleted,
}: {
  subscription: Detail["subscription"];
  onDeleted: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const remove = useMutation(
    trpc.events.subscriptions.remove.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.events.subscriptions.pathKey() });
        onDeleted();
      },
    }),
  );

  return (
    <div className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Delete {subscription.name}?</DialogTitle>
        <DialogDescription>
          Events stop going to this endpoint at once. Its delivery log is kept.
        </DialogDescription>
      </DialogHeader>
      {remove.error && (
        <Notice tone="error" title="Couldn't delete">
          {remove.error.message}
        </Notice>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ id: subscription.id })}
        >
          {remove.isPending && <Spinner />}
          Delete endpoint
        </Button>
      </DialogFooter>
    </div>
  );
}

import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Radio } from "lucide-react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { RunStatusChip, subjectLink, workflowName } from "@/components/workflows/labels";
import { formatDateTime } from "@/lib/environment";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/developers/workflows/$runId")({
  component: RunPage,
});

const LIVE = new Set(["pending", "running", "waiting"]);
const json = (value: unknown) => JSON.stringify(value, null, 2);

function RunPage() {
  const { runId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const run = useQuery({ ...trpc.workflows.get.queryOptions({ runId }), refetchInterval: 5_000 });
  const [cancelling, setCancelling] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.workflows.pathKey() });
  const retry = useMutation(trpc.workflows.retry.mutationOptions({ onSuccess: refresh }));
  const wake = useMutation(trpc.workflows.wakeNow.mutationOptions({ onSuccess: refresh }));
  const r = run.data;
  const timed = r?.waits.some((w) => w.wakeAt) ?? false;
  const failure = run.error ?? retry.error ?? wake.error;

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="runs" to="/settings/developers/workflows">
                Workflows
              </Link>,
            ]}
            current={r && workflowName(r.workflowId)}
          />
        }
        actions={
          r && (
            <>
              {r.sandbox && r.status === "waiting" && timed && (
                <Button
                  variant="outline"
                  disabled={wake.isPending}
                  onClick={() => wake.mutate({ runId })}
                >
                  {wake.isPending && <Spinner />}
                  Wake now
                </Button>
              )}
              {LIVE.has(r.status) && (
                <Button variant="outline" onClick={() => setCancelling(true)}>
                  Cancel run
                </Button>
              )}
              {r.status === "failed" && (
                <Button disabled={retry.isPending} onClick={() => retry.mutate({ runId })}>
                  {retry.isPending && <Spinner />}
                  Retry run
                </Button>
              )}
            </>
          )
        }
      />
      <PageBody className="max-w-4xl">
        {failure && (
          <Notice tone="error" title="Something went wrong">
            {failure.message}
          </Notice>
        )}
        {!r ? (
          !run.error && <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
        ) : (
          <>
            <Panel
              title={
                <span className="flex items-center gap-3">
                  {r.label}
                  <RunStatusChip status={r.status} />
                </span>
              }
              description={r.reference ?? undefined}
            >
              <dl className="m-0 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <Fact label="Started">{formatDateTime(r.createdAt)}</Fact>
                <Fact label={r.completedAt ? "Finished" : "Last update"}>
                  {formatDateTime(r.completedAt ?? r.updatedAt)}
                </Fact>
                <Fact label="Current step">
                  <code className="font-mono text-xs">{r.currentStep}</code>
                </Fact>
                <Fact label="Attempts">{r.attempts}</Fact>
                {r.cancelReason && <Fact label="Cancel reason">{r.cancelReason}</Fact>}
                {r.error && (
                  <Fact label="Error" wide>
                    <span className="text-red-800">{r.error}</span>
                  </Fact>
                )}
                {r.subjects.length > 0 && (
                  <Fact label="Records" wide>
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {r.subjects.map((subject) => (
                        <SubjectLink key={subject} subject={subject} />
                      ))}
                    </span>
                  </Fact>
                )}
              </dl>
            </Panel>
            {LIVE.has(r.status) && (
              <Panel title="Waiting on" flush>
                {r.waits.length === 0 ? (
                  <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">
                    {r.status === "waiting" ? "Nothing recorded" : "Running now"}
                  </p>
                ) : (
                  <ul className="m-0 list-none divide-y p-0">
                    {r.waits.map((w) => (
                      <li key={w.stepId} className="flex gap-3 px-(--card-p) py-3.5">
                        <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">
                          {w.event ? <Radio /> : <Clock />}
                        </span>
                        <span className="grid gap-0.5">
                          <span className="text-sm leading-5 font-medium">
                            {w.event ? (
                              <>
                                Signal <code className="font-mono text-xs">{w.event}</code>
                                {w.wakeAt && `, or time out ${formatDateTime(w.wakeAt)}`}
                              </>
                            ) : (
                              w.wakeAt && `Wakes ${formatDateTime(w.wakeAt)}`
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            Step <code className="font-mono">{w.stepId}</code> · since{" "}
                            {formatRelative(w.since)}
                            {w.wallWakeAt &&
                              w.wallWakeAt !== w.wakeAt &&
                              ` · tenant time; fires ${formatDateTime(w.wallWakeAt)} on the wall clock`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            <Panel title="Completed steps" flush>
              {r.steps.length === 0 ? (
                <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">None yet</p>
              ) : (
                <ol className="m-0 list-none divide-y p-0">
                  {r.steps.map((s) => (
                    <li key={s.stepId} className="px-(--card-p) py-3">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                          <code className="font-mono text-xs font-medium">{s.stepId}</code>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatDateTime(s.completedAt)}
                          </span>
                        </summary>
                        <pre className="m-0 mt-2 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
                          {json(s.result)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            {r.signals.length > 0 && (
              <Panel title="Signals" flush>
                <ul className="m-0 list-none divide-y p-0">
                  {r.signals.map((s, i) => (
                    <li key={i} className="grid gap-1 px-(--card-p) py-3">
                      <span className="flex justify-between gap-4 text-xs">
                        <code className="font-mono font-medium">{s.name}</code>
                        <span className="text-muted-foreground tabular-nums">
                          {formatDateTime(s.at)}
                          {s.consumedBy ? ` · read by ${s.consumedBy}` : " · unread"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel title="Input">
              <pre className="m-0 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
                {json(r.input)}
              </pre>
              {r.idempotencyKey && (
                <p className="m-0 mt-3 text-xs text-muted-foreground">
                  Idempotency key <code className="font-mono">{r.idempotencyKey}</code>
                </p>
              )}
            </Panel>
          </>
        )}
      </PageBody>
      <CancelDialog runId={runId} open={cancelling} onOpenChange={setCancelling} onDone={refresh} />
    </>
  );
}

function Fact({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "grid gap-1 sm:col-span-2" : "grid gap-1"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  );
}

function SubjectLink({ subject }: { subject: string }) {
  const link = subjectLink(subject);
  const [type] = subject.split(":");
  const words = (type ?? "").replace("_", " ");
  const name = words.charAt(0).toUpperCase() + words.slice(1);

  if (!link) return <span className="text-muted-foreground">{name}</span>;

  return (
    <Link {...link} className="font-medium text-primary hover:underline">
      {name}
    </Link>
  );
}

function CancelDialog({
  runId,
  open,
  onOpenChange,
  onDone,
}: {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const trpc = useTRPC();
  const [reason, setReason] = useState("");

  const cancel = useMutation(
    trpc.workflows.cancel.mutationOptions({
      onSuccess: async () => {
        await onDone();
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            cancel.mutate({ runId, reason });
          }}
        >
          <DialogHeader>
            <DialogTitle>Cancel this run</DialogTitle>
            <DialogDescription>
              It stops at its next step and its timers are cleared. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
            />
          </div>
          {cancel.error && (
            <Notice tone="error" title="Couldn't cancel">
              {cancel.error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep running
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!reason.trim() || cancel.isPending}
            >
              {cancel.isPending && <Spinner />}
              Cancel run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

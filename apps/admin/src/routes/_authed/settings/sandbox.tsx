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
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, FlaskConical, History } from "lucide-react";
import { useId, useState } from "react";
import { authClient } from "@/lib/auth";
import { formatDateTime, useEnvironment } from "@/lib/environment";
import { formatDate } from "@/lib/format";
import { useSwitchOrganization } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/sandbox")({
  component: SandboxPage,
});

const DAY_MS = 86_400_000;

const QUICK_STEPS = [
  { label: "+1 day", days: 1 },
  { label: "+1 week", days: 7 },
  { label: "+30 days", days: 30 },
] as const;

const OUTCOME_TONES: Record<string, StatusTone> = {
  in_force: "success",
  issued: "success",
  expired: "success",
  completed: "success",
  failed: "danger",
};

const readable = (value: string) => {
  const text = value.replaceAll("_", " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Noon UTC is past 12:01 a.m. local time in every US jurisdiction, so the whole day's events run.
const endOfDay = (date: string) => `${date}T12:00:00Z`;

const addMs = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();

function SandboxPage() {
  const environment = useEnvironment();

  if (environment.error) {
    return (
      <>
        <PageHeader title="Sandbox" />
        <PageBody className="max-w-4xl">
          <Notice tone="error" title="Couldn't load the environment">
            {environment.error.message}
          </Notice>
        </PageBody>
      </>
    );
  }

  if (!environment.data) {
    return (
      <>
        <PageHeader title="Sandbox" />
        <PageBody className="max-w-4xl">
          <Panel>
            <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
          </Panel>
        </PageBody>
      </>
    );
  }

  return environment.data.kind === "sandbox" ? (
    <TimeTravel
      now={environment.data.now}
      wallNow={addMs(environment.data.now, -environment.data.clockOffsetMs)}
      parent={environment.data.parent?.name ?? null}
    />
  ) : (
    <Sandboxes sandboxes={environment.data.sandboxes} />
  );
}

function Sandboxes({
  sandboxes,
}: {
  sandboxes: { tenantId: string; name: string; createdAt: string }[];
}) {
  const [open, setOpen] = useState(false);
  const switchTo = useSwitchOrganization();

  return (
    <>
      <PageHeader
        title="Sandbox"
        actions={<Button onClick={() => setOpen(true)}>Create sandbox</Button>}
      />
      <PageBody className="max-w-4xl">
        <Panel
          title="Sandboxes"
          description="Copies of this organization's configuration with a clock you control. They always use test payments, e-signature and email."
          flush
        >
          {sandboxes.length === 0 ? (
            <EmptyState icon={<FlaskConical />} title="No sandboxes yet" />
          ) : (
            <ul className="m-0 divide-y p-0">
              {sandboxes.map((sandbox) => (
                <li
                  key={sandbox.tenantId}
                  className="flex items-center justify-between gap-4 px-(--card-p) py-3"
                >
                  <div className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm font-medium">{sandbox.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Created {formatDate(sandbox.createdAt)}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => switchTo(sandbox.tenantId)}>
                    Switch to sandbox
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
      <CreateSandboxDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function CreateSandboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const nameId = useId();
  const switchTo = useSwitchOrganization();
  const { data: active } = authClient.useActiveOrganization();
  const [name, setName] = useState("");

  const create = useMutation(
    trpc.tenant.createSandbox.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.tenant.environment.queryFilter());
        await authClient.organization.list();
      },
    }),
  );

  const placeholder = active ? `${active.name} Sandbox` : "Sandbox";
  const copied = create.data?.copied;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) create.reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{create.data ? "Sandbox ready" : "Create sandbox"}</DialogTitle>
          <DialogDescription>
            {create.data
              ? `${create.data.name} has its own clock, starting today.`
              : "Copies products, releases, branding and the forms library. Policies and quotes stay in production."}
          </DialogDescription>
        </DialogHeader>
        {create.data && copied ? (
          <dl className="m-0 grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
            {[
              ["Products", copied.products ?? 0],
              ["Releases", copied.releases ?? 0],
              ["Forms", copied.formEditions ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="m-0 font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <form
            id="create-sandbox"
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate({ name: name.trim() || placeholder });
            }}
          >
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              placeholder={placeholder}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            {create.error && (
              <Notice tone="error" title="Couldn't create the sandbox">
                {create.error.message}
              </Notice>
            )}
          </form>
        )}
        <DialogFooter>
          {create.data ? (
            <>
              <DialogClose asChild>
                <Button variant="outline">Stay here</Button>
              </DialogClose>
              <Button onClick={() => switchTo(create.data.tenantId)}>Switch to sandbox</Button>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" form="create-sandbox" disabled={create.isPending}>
                {create.isPending && <Spinner />}
                Create sandbox
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Timer = {
  runId: string;
  dueAt: string;
  label: string;
  reference: string | null;
  outcome?: string;
};

function TimeTravel({
  now,
  wallNow,
  parent,
}: {
  now: string;
  wallNow: string;
  parent: string | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const dateId = useId();
  const [target, setTarget] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Timer[]>([]);

  const next = useQuery(trpc.tenant.time.preview.queryOptions({ to: null }));

  const advance = useMutation(
    trpc.tenant.time.advance.mutationOptions({
      onSuccess: async () => {
        setTarget(null);
        await queryClient.invalidateQueries();
      },
    }),
  );

  const preview = useQuery({
    ...trpc.tenant.time.preview.queryOptions({ to: target }),
    enabled: target !== null,
    refetchInterval: advance.isPending ? 800 : false,
  });

  const history = useQuery(trpc.tenant.time.history.queryOptions());

  const nextEvent = next.data?.timers.find((t) => new Date(t.dueAt) > new Date(now));
  const pending = new Set(preview.data?.timers.map((t) => t.runId + t.dueAt));
  const rows = advance.isPending ? snapshot : (preview.data?.timers ?? []);

  const start = () => {
    if (!target) return;

    setSnapshot(preview.data?.timers ?? []);
    advance.mutate({ to: target });
  };

  return (
    <>
      <PageHeader title="Sandbox time" />
      <PageBody className="max-w-4xl">
        <Panel>
          <div className="grid gap-6">
            <div className="grid gap-1">
              <p className="m-0 text-xs text-muted-foreground">Sandbox today</p>
              <p className="m-0 text-3xl leading-9 font-semibold tracking-tight tabular-nums">
                {formatDate(now)}
              </p>
              <p className="m-0 text-sm text-muted-foreground tabular-nums">
                {formatDateTime(now)}
                {parent && ` · ${parent} is on ${formatDate(wallNow)}`}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {QUICK_STEPS.map((step) => (
                <Button
                  key={step.label}
                  variant="outline"
                  size="sm"
                  disabled={advance.isPending}
                  onClick={() => setTarget(addMs(now, step.days * DAY_MS))}
                >
                  {step.label}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                disabled={!nextEvent || advance.isPending}
                onClick={() => nextEvent && setTarget(addMs(nextEvent.dueAt, 1_000))}
              >
                To next event
              </Button>
              <div className="ml-auto grid gap-1.5">
                <Label htmlFor={dateId} className="text-xs text-muted-foreground">
                  Advance to date
                </Label>
                <Input
                  id={dateId}
                  type="date"
                  className="h-8 w-40 tabular-nums"
                  min={now.slice(0, 10)}
                  disabled={advance.isPending}
                  onChange={(event) =>
                    event.target.value && setTarget(endOfDay(event.target.value))
                  }
                />
              </div>
            </div>
          </div>
        </Panel>

        {advance.error && (
          <Notice tone="error" title="Couldn't advance time">
            {advance.error.message}
          </Notice>
        )}

        {target && (
          <Panel
            title="What will happen"
            description={`Scheduled before ${formatDateTime(target)}, in order.`}
            flush
            footer={
              <div className="flex items-center justify-end">
                <Button onClick={start} disabled={advance.isPending || preview.isLoading}>
                  {advance.isPending && <Spinner />}
                  Advance to {formatDate(target)}
                </Button>
              </div>
            }
          >
            {preview.isLoading ? (
              <div className="p-(--card-p)">
                <div className="h-12 animate-pulse rounded-lg bg-muted/60" />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Nothing is scheduled before then" />
            ) : (
              <TimerList
                timers={rows}
                status={(timer) =>
                  advance.isPending
                    ? pending.has(timer.runId + timer.dueAt)
                      ? { tone: "neutral", label: "Waiting" }
                      : { tone: "success", label: "Ran" }
                    : null
                }
              />
            )}
          </Panel>
        )}

        {advance.data && (
          <Panel
            title="What ran"
            description={`${formatDateTime(advance.data.from)} → ${formatDateTime(advance.data.to)}`}
            flush
          >
            {advance.data.fired.length === 0 ? (
              <EmptyState icon={<CalendarClock />} title="Nothing was due" />
            ) : (
              <TimerList
                timers={advance.data.fired.map((f, i) => ({ ...f, runId: String(i) }))}
                status={(timer) =>
                  timer.outcome
                    ? {
                        tone: OUTCOME_TONES[timer.outcome] ?? "neutral",
                        label: readable(timer.outcome),
                      }
                    : null
                }
              />
            )}
          </Panel>
        )}

        <Panel title="History" flush>
          {history.data?.length ? (
            <ul className="m-0 divide-y p-0">
              {history.data.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-4 px-(--card-p) py-3 text-sm"
                >
                  <span className="tabular-nums">
                    {formatDateTime(entry.from)} → {formatDateTime(entry.to)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {entry.fired.length === 1 ? "1 event" : `${entry.fired.length} events`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<History />} title="Time hasn't moved yet" />
          )}
        </Panel>
      </PageBody>
    </>
  );
}

function TimerList({
  timers,
  status,
}: {
  timers: Timer[];
  status: (timer: Timer) => { tone: StatusTone; label: string } | null;
}) {
  return (
    <ul className="m-0 divide-y p-0">
      {timers.map((timer) => (
        <li
          key={timer.runId + timer.dueAt}
          className="flex items-center gap-4 px-(--card-p) py-3 text-sm"
        >
          <span className="w-44 shrink-0 text-muted-foreground tabular-nums">
            {formatDateTime(timer.dueAt)}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{timer.label}</span>
          {timer.reference && (
            <span className="text-muted-foreground tabular-nums">{timer.reference}</span>
          )}
          <span className="flex w-20 justify-end">
            <TimerStatus status={status(timer)} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function TimerStatus({ status }: { status: { tone: StatusTone; label: string } | null }) {
  return status && <StatusChip tone={status.tone}>{status.label}</StatusChip>;
}

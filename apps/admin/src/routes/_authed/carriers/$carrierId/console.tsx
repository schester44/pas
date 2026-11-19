import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Notice } from "@pas/ui/components/notice";
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
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/distribution/agency-dialog";
import {
  CAPABILITIES,
  type Capability,
  capabilityLabel,
  type FlowRun,
  RUN_TONES,
  runLabel,
} from "@/components/carriers/labels";
import { formatRelative } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/$carrierId/console")({
  component: ConsoleTab,
  validateSearch: (search: Record<string, unknown>): { run?: string } =>
    typeof search.run === "string" ? { run: search.run } : {},
});

function ConsoleTab() {
  const { carrierId } = Route.useParams();
  const { run: runId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useTRPC();
  const access = useAccess();
  const carrier = useQuery(trpc.carriers.get.queryOptions({ id: carrierId }));
  const versions = carrier.data?.versions ?? [];
  const [versionId, setVersionId] = useState<string>();
  const chosen = versionId ?? versions.find((v) => v.status === "draft")?.id ?? versions[0]?.id;
  const version = versions.find((v) => v.id === chosen);
  const [capability, setCapability] = useState<Capability>("quote");
  const sample = useQuery(trpc.carriers.console.sample.queryOptions({ capability }));
  const [edited, setEdited] = useState<string | null>(null);
  const input = edited ?? (sample.data ? JSON.stringify(sample.data, null, 2) : "");

  const parsed = (() => {
    try {
      return { ok: true as const, value: JSON.parse(input) as Record<string, unknown> };
    } catch (error) {
      return { ok: false as const, message: (error as Error).message };
    }
  })();

  const run = useMutation(
    trpc.carriers.console.run.mutationOptions({
      onSuccess: ({ flowRunId }) => navigate({ search: { run: flowRunId } }),
    }),
  );

  const available = CAPABILITIES.filter((c) => version?.capabilities.includes(c.value));

  return (
    <PageBody className="max-w-7xl">
      <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <Panel
            title="Run a capability"
            description="Against the test environment, with a sample in the canonical model."
            footer={
              access.products.write && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={
                      !chosen ||
                      !parsed.ok ||
                      run.isPending ||
                      !version?.capabilities.includes(capability)
                    }
                    onClick={() =>
                      parsed.ok &&
                      chosen &&
                      run.mutate({ carrierId, versionId: chosen, capability, input: parsed.value })
                    }
                  >
                    {run.isPending && <Spinner />}
                    Run {capabilityLabel(capability).toLowerCase()}
                  </Button>
                </div>
              )
            }
          >
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Connector" id="console-version">
                  <Select value={chosen ?? ""} onValueChange={setVersionId}>
                    <SelectTrigger id="console-version">
                      <SelectValue placeholder="No versions" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          Version {v.version}
                          {v.status === "draft" ? " (draft)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Capability" id="console-capability">
                  <Select
                    value={capability}
                    onValueChange={(v) => {
                      setCapability(v as Capability);
                      setEdited(null);
                    }}
                  >
                    <SelectTrigger id="console-capability">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {available.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <Field label="Sample policy" id="console-input">
                <Textarea
                  id="console-input"
                  rows={16}
                  spellCheck={false}
                  className="font-mono text-[11px] leading-4"
                  value={input}
                  onChange={(e) => setEdited(e.target.value)}
                />
                {!parsed.ok && <p className="m-0 text-xs text-destructive">{parsed.message}</p>}
              </Field>
              {run.error && (
                <Notice tone="error" title="Couldn't start the run">
                  {run.error.message}
                </Notice>
              )}
            </div>
          </Panel>
          <Fixtures carrierId={carrierId} />
        </div>
        {runId ? (
          <RunView key={runId} runId={runId} />
        ) : (
          <RecentRuns carrierId={carrierId} onOpen={(id) => navigate({ search: { run: id } })} />
        )}
      </div>
    </PageBody>
  );
}

function RecentRuns({ carrierId, onOpen }: { carrierId: string; onOpen: (id: string) => void }) {
  const trpc = useTRPC();
  const runs = useQuery(trpc.carriers.runs.list.queryOptions({ carrierId }));

  return (
    <Panel flush title="Recent runs">
      {runs.data?.length === 0 ? (
        <EmptyState
          title="Nothing run yet"
          description="Run a capability to see every request and response."
        />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {(runs.data ?? []).slice(0, 15).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                className="flex w-full items-center gap-3 px-(--card-p) py-3 text-left hover:bg-muted/40"
              >
                <span className="grid flex-1 gap-0.5">
                  <span className="text-sm font-medium">{capabilityLabel(r.capability)}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.mode === "test" ? "Test console" : r.subject.kind.replace("_", " ")} ·{" "}
                    {formatRelative(r.startedAt)}
                  </span>
                </span>
                <StatusChip tone={RUN_TONES[r.status] ?? "neutral"}>
                  {runLabel(r.status)}
                </StatusChip>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function RunView({ runId }: { runId: string }) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();

  const run = useQuery(
    trpc.carriers.runs.get.queryOptions(
      { id: runId },
      {
        refetchInterval: (query) =>
          ["running", "waiting"].includes(query.state.data?.status ?? "running") ? 1000 : false,
      },
    ),
  );

  const [name, setName] = useState("");

  const save = useMutation(
    trpc.carriers.fixtures.save.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.carriers.fixtures.list.queryKey() }),
    }),
  );

  if (!run.data) return <div className="h-96 animate-pulse rounded-xl bg-muted/60" />;

  const r = run.data;
  const done = r.status === "succeeded" || r.status === "failed";
  const total = r.exchanges.reduce((sum, e) => sum + e.durationMs, 0);

  return (
    <div className="grid content-start gap-6">
      <Panel
        flush
        title={`${capabilityLabel(r.capability)} · ${r.environment === "live" ? "live" : "test"} environment`}
        description={`${r.exchanges.length} exchange${r.exchanges.length === 1 ? "" : "s"} · ${total} ms on the wire · connector ${r.connectorVersion ? `v${r.connectorVersion}` : "extension"}`}
        action={
          <StatusChip tone={RUN_TONES[r.status] ?? "neutral"}>{runLabel(r.status)}</StatusChip>
        }
      >
        <ol className="m-0 list-none divide-y p-0">
          {r.exchanges.map((exchange) => (
            <ExchangeRow key={exchange.id} exchange={exchange} />
          ))}
          {!done && (
            <li className="flex items-center gap-2 px-(--card-p) py-3 text-sm text-muted-foreground">
              <Spinner className="size-3.5" />
              {r.status === "waiting"
                ? "Waiting for the carrier's callback"
                : "Talking to the carrier"}
            </li>
          )}
        </ol>
      </Panel>
      {done && r.output && <Outcome run={r} />}
      {done && access.products.write && (
        <Panel
          title="Save as fixture"
          description="The test suite replays it against every new connector version before it can be published."
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({ flowRunId: r.id, name });
            }}
          >
            <Input
              aria-label="Fixture name"
              placeholder={`${capabilityLabel(r.capability)}: ${r.output?.outcome.status ?? "failed"}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={save.isPending || save.isSuccess}>
              {save.isPending && <Spinner />}
              {save.isSuccess ? "Saved" : "Save fixture"}
            </Button>
          </form>
          {save.error && <p className="m-0 mt-2 text-xs text-destructive">{save.error.message}</p>}
        </Panel>
      )}
    </div>
  );
}

function ExchangeRow({ exchange }: { exchange: FlowRun["exchanges"][number] }) {
  const [open, setOpen] = useState(false);
  const status = exchange.response?.status;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-(--card-p) py-2.5 text-left hover:bg-muted/40"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="w-28 shrink-0 truncate font-mono text-xs">{exchange.stepId}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {exchange.kind === "callback"
            ? "Callback received"
            : `${exchange.request.method} ${exchange.request.url ? new URL(exchange.request.url).pathname : ""}`}
          {exchange.kind === "compensation" && " (compensation)"}
          {exchange.attempt > 1 && ` · attempt ${exchange.attempt}`}
        </span>
        {status !== undefined && (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              exchange.ok ? "text-emerald-700" : "text-red-700",
            )}
          >
            {status}
          </span>
        )}
        <span className="w-14 text-right text-xs text-muted-foreground tabular-nums">
          {exchange.durationMs} ms
        </span>
      </button>
      {open && (
        <div className="grid gap-3 bg-muted/30 px-(--card-p) pt-1 pb-4 sm:grid-cols-2">
          <Payload
            title="Request"
            value={{ headers: exchange.request.headers, body: exchange.request.body }}
          />
          <Payload
            title={exchange.error ? `Response · ${exchange.error}` : "Response"}
            value={exchange.response?.body ?? null}
          />
        </div>
      )}
    </li>
  );
}

function Payload({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <p className="m-0 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="m-0 max-h-72 overflow-auto rounded-md border bg-background px-2.5 py-2 font-mono text-[11px] leading-4">
        {pretty(value)}
      </pre>
    </div>
  );
}

function Outcome({ run }: { run: FlowRun }) {
  const outcome = run.output!.outcome;

  return (
    <Panel
      title="Mapped outcome"
      description={
        run.output!.compensated.length > 0
          ? `Failed at ${run.output!.failedStep}; compensated with ${run.output!.compensated.join(", ")}.`
          : run.output!.failedStep
            ? `Failed at ${run.output!.failedStep}.`
            : "What PAS applies, per the product's ownership matrix."
      }
    >
      <pre className="m-0 max-h-96 overflow-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px] leading-4">
        {pretty(outcome)}
      </pre>
    </Panel>
  );
}

function Fixtures({ carrierId }: { carrierId: string }) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const fixtures = useQuery(trpc.carriers.fixtures.list.queryOptions({ carrierId }));

  const remove = useMutation(
    trpc.carriers.fixtures.delete.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.carriers.fixtures.list.queryKey({ carrierId }),
        }),
    }),
  );

  return (
    <Panel
      flush
      title="Recorded fixtures"
      description="Replayed by the test suite; every capability needs one to publish."
    >
      {fixtures.data?.length === 0 ? (
        <EmptyState title="No fixtures yet" description="Run a capability, then save the run." />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {(fixtures.data ?? []).map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-(--card-p) py-2.5">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{f.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {capabilityLabel(f.capability)} · {f.exchanges} request
                  {f.exchanges === 1 ? "" : "s"}
                  {f.callbacks > 0 && ` · ${f.callbacks} callback`} · {f.expected.status}
                </span>
              </span>
              {access.products.write && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => remove.mutate({ id: f.id })}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

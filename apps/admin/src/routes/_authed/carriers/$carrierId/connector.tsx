import { Button } from "@pas/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Notice } from "@pas/ui/components/notice";
import { PageBody } from "@pas/ui/components/page";
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
import { StatusChip } from "@pas/ui/components/status-chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FlowEditor } from "@/components/carriers/flow-editor";
import {
  CAPABILITIES,
  type Capability,
  capabilityLabel,
  type ConnectorVersion,
  type Definition,
} from "@/components/carriers/labels";
import { MappingEditor } from "@/components/carriers/mapping-editor";
import { formatDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/$carrierId/connector")({
  component: ConnectorTab,
  validateSearch: (search: Record<string, unknown>): { version?: string; capability?: string } => ({
    ...(typeof search.version === "string" && { version: search.version }),
    ...(typeof search.capability === "string" && { capability: search.capability }),
  }),
});

const STATUS_TONE = { draft: "accent", published: "success", retired: "neutral" } as const;

function ConnectorTab() {
  const { carrierId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const carrier = useQuery(trpc.carriers.get.queryOptions({ id: carrierId }));
  const versions = carrier.data?.versions ?? [];

  const versionId =
    search.version ?? versions.find((v) => v.status === "draft")?.id ?? versions[0]?.id;

  const version = useQuery({
    ...trpc.carriers.connector.get.queryOptions({ id: versionId ?? "" }),
    enabled: !!versionId,
  });

  const runs = useQuery(trpc.carriers.runs.list.queryOptions({ carrierId }));
  const [edits, setEdits] = useState<{ versionId: string; definition: Definition } | null>(null);
  const dirty = !!edits && edits.versionId === version.data?.id;
  const definition = dirty ? edits.definition : (version.data?.definition ?? null);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: trpc.carriers.get.queryKey({ id: carrierId }),
    });

    await queryClient.invalidateQueries({ queryKey: trpc.carriers.connector.get.queryKey() });
  };

  const createDraft = useMutation(
    trpc.carriers.connector.createDraft.mutationOptions({
      onSuccess: async (draft) => {
        await refresh();
        void navigate({ search: { version: draft.id } });
      },
    }),
  );

  const save = useMutation(
    trpc.carriers.connector.update.mutationOptions({
      onSuccess: (saved) => {
        queryClient.setQueryData(trpc.carriers.connector.get.queryKey({ id: saved.id }), saved);
        setEdits(null);
      },
    }),
  );

  const test = useMutation(trpc.carriers.connector.test.mutationOptions({ onSuccess: refresh }));

  const publish = useMutation(
    trpc.carriers.connector.publish.mutationOptions({ onSuccess: refresh }),
  );

  const configured = definition ? CAPABILITIES.filter((c) => definition.capabilities[c.value]) : [];

  const capability = (configured.find((c) => c.value === search.capability)?.value ??
    configured[0]?.value) as Capability | undefined;

  const sample = useQuery({
    ...trpc.carriers.console.sample.queryOptions({ capability: capability ?? "quote" }),
    enabled: !!capability,
  });

  const last = runs.data?.find((r) => r.capability === capability && r.output);

  const context = {
    input: last?.input ?? sample.data ?? {},
    steps: last?.output?.steps ?? {},
    callback: { url: "https://pas/callback" },
    connection: { environment: "test" },
  };

  if (!carrier.data || (versionId && !version.data)) {
    return (
      <PageBody className="max-w-7xl">
        <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
      </PageBody>
    );
  }

  const v = version.data;
  const readOnly = !access.products.write || v?.status !== "draft";
  const issues = v?.issues ?? [];
  const report = test.data ?? v?.testReport ?? null;

  const update = (next: Definition) => v && setEdits({ versionId: v.id, definition: next });

  return (
    <PageBody className="max-w-7xl">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={versionId ?? ""}
          onValueChange={(id) => navigate({ search: { version: id } })}
        >
          <SelectTrigger className="w-56" aria-label="Connector version">
            <SelectValue placeholder="No versions yet" />
          </SelectTrigger>
          <SelectContent>
            {versions.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                Version {item.version} ·{" "}
                {item.status === "draft"
                  ? "Draft"
                  : item.status === "published"
                    ? "Published"
                    : "Retired"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {v && (
          <StatusChip tone={STATUS_TONE[v.status]}>
            {v.status === "draft" ? "Draft" : v.status === "published" ? "Published" : "Retired"}
          </StatusChip>
        )}
        {v?.publishedAt && (
          <span className="text-xs text-muted-foreground">
            Published {formatDate(v.publishedAt)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {access.products.write && !versions.some((x) => x.status === "draft") && (
            <Button
              size="sm"
              variant="outline"
              disabled={createDraft.isPending}
              onClick={() =>
                createDraft.mutate({ carrierId, ...(versionId && { copyFromId: versionId }) })
              }
            >
              {createDraft.isPending && <Spinner />}
              {versions.length === 0 ? "Start a connector" : "Edit in a new version"}
            </Button>
          )}
          {v?.status === "draft" && !readOnly && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => definition && save.mutate({ id: v.id, definition })}
              >
                {save.isPending && <Spinner />}
                {dirty ? "Save changes" : "Saved"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={dirty || test.isPending}
                onClick={() => test.mutate({ id: v.id })}
              >
                {test.isPending && <Spinner />}
                Run test suite
              </Button>
            </>
          )}
          {v?.status === "draft" && access.products.publish && (
            <Button
              size="sm"
              disabled={dirty || publish.isPending}
              onClick={() => publish.mutate({ id: v.id })}
            >
              {publish.isPending && <Spinner />}
              Publish version {v.version}
            </Button>
          )}
        </div>
      </div>
      {(save.error ?? publish.error ?? createDraft.error) && (
        <Notice tone="error" title="Couldn't do that">
          {(save.error ?? publish.error ?? createDraft.error)?.message}
        </Notice>
      )}
      {!v || !definition ? (
        <Notice title="No connector yet">
          Start a connector to describe how each capability talks to the carrier.
        </Notice>
      ) : (
        <>
          {report && <SuiteReport report={report} />}
          {issues.length > 0 && (
            <Notice
              tone="warning"
              title={`${issues.length} problem${issues.length === 1 ? "" : "s"} to fix before publishing`}
            >
              {issues
                .slice(0, 4)
                .map((i) =>
                  [i.capability && capabilityLabel(i.capability), i.step, i.field, i.message]
                    .filter(Boolean)
                    .join(" · "),
                )
                .join("; ")}
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {configured.length > 0 && capability && (
              <SegmentedControl
                label="Capability"
                value={capability}
                onValueChange={(next) =>
                  navigate({ search: { version: versionId, capability: next } })
                }
                options={configured.map((c) => ({
                  value: c.value,
                  label: (
                    <span className="flex items-center gap-1.5">
                      {c.label}
                      {issues.some((i) => i.capability === c.value) && (
                        <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
                      )}
                    </span>
                  ),
                }))}
              />
            )}
            {!readOnly && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Plus /> Add capability
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {CAPABILITIES.filter((c) => !definition.capabilities[c.value]).map((c) => (
                    <DropdownMenuItem
                      key={c.value}
                      onSelect={() => {
                        update({
                          ...definition,
                          capabilities: {
                            ...definition.capabilities,
                            [c.value]: { steps: [], output: '{ status: "confirmed" }' },
                          },
                        });

                        void navigate({ search: { version: versionId, capability: c.value } });
                      }}
                    >
                      <span className="grid">
                        <span className="text-sm font-medium">{c.label}</span>
                        <span className="text-xs text-muted-foreground">{c.description}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!readOnly && capability && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  const { [capability]: _removed, ...rest } = definition.capabilities;

                  update({ ...definition, capabilities: rest });
                }}
              >
                <Trash2 /> Remove {capabilityLabel(capability).toLowerCase()}
              </Button>
            )}
          </div>
          {capability && definition.capabilities[capability] && (
            <FlowEditor
              key={`${v.id}-${capability}`}
              flow={definition.capabilities[capability]!}
              context={context}
              issues={issues.filter((i) => i.capability === capability)}
              readOnly={readOnly}
              onChange={(flow) =>
                update({
                  ...definition,
                  capabilities: { ...definition.capabilities, [capability]: flow },
                })
              }
            />
          )}
          <Panel
            title="Callbacks"
            description="Finds the correlation key in an inbound callback so the waiting flow resumes."
          >
            <MappingEditor
              id="callback-correlation"
              value={definition.callbacks.correlation}
              rows={1}
              readOnly={readOnly}
              context={{ body: { applicationId: "APP-1234ABCD", decision: "quoted" }, headers: {} }}
              onChange={(correlation) => update({ ...definition, callbacks: { correlation } })}
            />
          </Panel>
        </>
      )}
    </PageBody>
  );
}

function SuiteReport({ report }: { report: NonNullable<ConnectorVersion["testReport"]> }) {
  const failed = report.results.filter((r) => !r.passed);

  return (
    <Panel
      flush
      title={report.passed ? "Test suite passed" : "Test suite failed"}
      description={`${report.results.length} fixture${report.results.length === 1 ? "" : "s"} replayed against this version with a mock HTTP layer.${report.missing.length ? ` No fixture yet for ${report.missing.map(capabilityLabel).join(", ").toLowerCase()}.` : ""}`}
      action={
        <StatusChip tone={report.passed ? "success" : "danger"}>
          {report.passed ? "Passing" : `${failed.length + report.missing.length} failing`}
        </StatusChip>
      }
    >
      <ul className="m-0 list-none divide-y p-0">
        {report.results.map((result) => (
          <li key={result.fixtureId} className="flex items-start gap-3 px-(--card-p) py-3">
            <span
              aria-hidden
              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${result.passed ? "bg-emerald-500" : "bg-red-500"}`}
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="text-sm font-medium">{result.name}</span>
              <span className="text-xs text-muted-foreground">
                {capabilityLabel(result.capability)}
                {result.problems.length > 0 && ` · ${result.problems.join("; ")}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

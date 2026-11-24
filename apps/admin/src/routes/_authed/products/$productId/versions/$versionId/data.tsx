import {
  CAPABILITY_FIELDS,
  CAPABILITY_REQUEST_FIELDS,
  costClasses,
  derivationKinds,
  type EnrichmentCall,
  type EnrichmentDerivation,
  type EnrichmentMapping,
  type EnrichmentPlan,
  type EnrichmentReport,
  enrichmentSchema,
  enrichmentStages,
  type EnrichmentStage,
  type EnrichmentTransform,
  enrichmentModes,
  providerCapabilities,
  type ProviderCapability,
  reportSources,
  sampleSources,
} from "@pas/enrichment";
import { evaluate } from "@pas/expressions";
import { indexSchema, isField, type RiskSchema } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Database, Plus, Trash2, X } from "lucide-react";
import { useId, useMemo } from "react";
import { ExpressionInput } from "@/components/builders/expression-input";
import { Code, IconAction } from "@/components/builders/inspector";
import { PathPicker } from "@/components/builders/path-picker";
import { useVersionEditor } from "@/components/catalog/version-editor";
import { useExpressionsReady } from "@pas/forms-react";
import { useTRPC } from "@/lib/trpc";

type Section = "calls" | "derivations" | "transforms" | "mappings" | "reports";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/data")({
  validateSearch: (search: Record<string, unknown>): { item?: string } =>
    typeof search.item === "string" ? { item: search.item } : {},
  component: DataTab,
});

const STAGE_LABELS: Record<EnrichmentStage, string> = {
  prefill: "Prefill",
  pre_rate: "Before rating",
  pre_bind: "Before binding",
  renewal: "Renewal",
};

const CAPABILITY_LABELS: Record<ProviderCapability, string> = {
  geocode: "Geocode",
  property_characteristics: "Property characteristics",
  hazard_scores: "Hazard scores",
  tax_jurisdiction: "Tax jurisdiction",
  replacement_cost: "Replacement cost",
};

const MODE_LABELS: Record<(typeof enrichmentModes)[number], string> = {
  prefill: "Prefill (user can change)",
  authoritative: "Authoritative",
  uw_only: "Underwriting only",
};

const REPORT_SOURCE_LABELS: Record<(typeof reportSources)[number], string> = {
  vendor: "From the provider",
  template: "Generated from a template",
  vendor_then_template: "Provider, else generated",
};

const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

function uniqueId(taken: readonly string[], base: string): string {
  if (!taken.includes(base)) return base;

  let n = 2;

  while (taken.includes(`${base}_${n}`)) n++;

  return `${base}_${n}`;
}

const allCalls = (plan: EnrichmentPlan) =>
  enrichmentStages.flatMap((stage) => (plan.stages[stage] ?? []).map((call) => ({ stage, call })));

function withCalls(
  plan: EnrichmentPlan,
  entries: { stage: EnrichmentStage; call: EnrichmentCall }[],
) {
  const stages: EnrichmentPlan["stages"] = {};

  for (const { stage, call } of entries) stages[stage] = [...(stages[stage] ?? []), call];

  return { ...plan, stages };
}

/** Every source ref the plan produces, labelled for pickers. */
function sourceOptions(plan: EnrichmentPlan): { ref: string; label: string }[] {
  const index = indexSchema({ fields: enrichmentSchema(plan).children });

  return [...index]
    .filter(([path, node]) => isField(node) && !path.includes("[]"))
    .map(([path, node]) => {
      const [kind, id] = path.split(".");

      return { ref: path, label: kind === "derived" ? node.label : `${id} · ${node.label}` };
    });
}

function DataTab() {
  const { contents, readOnly, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useTRPC();
  const providers = useQuery(trpc.catalog.versions.dataProviders.queryOptions());
  const plan = contents.enrichment;
  const [section, item] = (search.item ?? "").split(":") as [Section | "", string | undefined];

  const save = (next: EnrichmentPlan, immediate?: boolean) => set("enrichment", next, immediate);

  const select = (s: Section, id: string) =>
    navigate({ search: { item: `${s}:${id}` }, replace: true });

  const clear = () => navigate({ search: {}, replace: true });

  const ids = [
    ...allCalls(plan).map((c) => c.call.id),
    ...plan.transforms.map((t) => t.id),
    ...plan.derivations.map((d) => d.id),
  ];

  const sources = useMemo(() => sourceOptions(plan), [plan]);

  const expressionSchema: RiskSchema = useMemo(
    () => ({
      fields: [
        { key: "risk", label: "Risk data", kind: "group", children: contents.riskSchema.fields },
        ...enrichmentSchema(plan).children,
      ],
    }),
    [contents.riskSchema, plan],
  );

  const add = {
    call: () => {
      const id = uniqueId(ids, "replacement_cost");

      save(
        withCalls(plan, [
          ...allCalls(plan),
          {
            stage: "pre_rate",
            call: {
              id,
              capability: "replacement_cost",
              providers: [],
              request: {},
              response: {},
              mode: "prefill",
              costClass: "medium",
              cacheTtl: "P30D",
              timeoutMs: 5000,
              combine: "fallback",
              fieldSources: {},
              dependsOn: [],
              optional: [],
            },
          },
        ]),
        true,
      );

      select("calls", id);
    },
    derivation: () => {
      const id = uniqueId(ids, "value");

      save(
        {
          ...plan,
          derivations: [
            ...plan.derivations,
            { id, stage: "pre_rate", label: "", kind: "number", expression: "" },
          ],
        },
        true,
      );

      select("derivations", id);
    },
    transform: () => {
      const id = uniqueId(ids, "transform");

      save(
        {
          ...plan,
          transforms: [
            ...plan.transforms,
            {
              id,
              stage: "pre_rate",
              extension: { key: "" },
              reads: [],
              writes: ["value"],
              onFailure: "block",
              timeoutMs: 2000,
            },
          ],
        },
        true,
      );

      select("transforms", id);
    },
    mapping: () => {
      save(
        {
          ...plan,
          mappings: [...plan.mappings, { from: sources[0]?.ref ?? "", to: "", mode: "prefill" }],
        },
        true,
      );

      select("mappings", String(plan.mappings.length));
    },
    report: () => {
      const id = uniqueId(
        plan.reports.map((r) => r.id),
        "report",
      );

      const call = allCalls(plan).find((c) => c.call.capability === "replacement_cost")?.call;

      save(
        {
          ...plan,
          reports: [
            ...plan.reports,
            {
              id,
              title: "Replacement cost report",
              stage: "pre_rate",
              source: "vendor_then_template",
              ...(call && { callId: call.id }),
            },
          ],
        },
        true,
      );

      select("reports", id);
    },
  };

  const addButton = (label: string, onClick: () => void) =>
    !readOnly && (
      <Button size="sm" variant="outline" onClick={onClick}>
        <Plus /> {label}
      </Button>
    );

  const selectedCall =
    section === "calls" ? allCalls(plan).find((c) => c.call.id === item) : undefined;

  const selectedDerivation =
    section === "derivations" ? plan.derivations.find((d) => d.id === item) : undefined;

  const selectedTransform =
    section === "transforms" ? plan.transforms.find((t) => t.id === item) : undefined;

  const mappingIndex = section === "mappings" ? Number(item) : -1;
  const selectedMapping = plan.mappings[mappingIndex];

  const selectedReport =
    section === "reports" ? plan.reports.find((r) => r.id === item) : undefined;

  return (
    <PageBody className="grid max-w-6xl gap-6">
      <Panel
        title="Sources"
        description="Data providers this product calls, when, and with which answers."
        action={allCalls(plan).length > 0 && addButton("Add source", add.call)}
        flush
      >
        {allCalls(plan).length === 0 ? (
          <EmptyState
            icon={<Database />}
            title="No data sources yet"
            description="Pull replacement costs, hazard scores and property details while quoting."
            action={addButton("Add source", add.call)}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Providers</TableHead>
                <TableHead>Answers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allCalls(plan).map(({ stage, call }) => (
                <TableRow
                  key={call.id}
                  aria-selected={call.id === selectedCall?.call.id}
                  onClick={() => select("calls", call.id)}
                  className={rowClass(call.id === selectedCall?.call.id)}
                >
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className="font-medium">{CAPABILITY_LABELS[call.capability]}</span>
                      <span className="font-mono text-xs text-muted-foreground">{call.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>{STAGE_LABELS[stage]}</TableCell>
                  <TableCell className={cn(call.providers.length === 0 && "text-muted-foreground")}>
                    {call.providers.length
                      ? call.providers
                          .map((id) => providers.data?.find((p) => p.id === id)?.name ?? id)
                          .join(" → ")
                      : "None chosen"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{MODE_LABELS[call.mode]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selectedCall && (
        <CallEditor
          key={selectedCall.call.id}
          stage={selectedCall.stage}
          call={selectedCall.call}
          schema={contents.riskSchema}
          providers={providers.data ?? []}
          readOnly={readOnly}
          onChange={(stage, call) => {
            save(
              withCalls(
                plan,
                allCalls(plan).map((c) =>
                  c.call.id === selectedCall.call.id ? { stage, call } : c,
                ),
              ),
            );

            if (call.id !== selectedCall.call.id && KEY.test(call.id)) select("calls", call.id);
          }}
          onRemove={() => {
            save(
              withCalls(
                plan,
                allCalls(plan).filter((c) => c.call.id !== selectedCall.call.id),
              ),
              true,
            );

            clear();
          }}
        />
      )}

      <Panel
        title="Calculated values"
        description="Values derived from the data with expressions, such as a dwelling limit from the replacement cost."
        action={addButton("Add value", add.derivation)}
        flush
      >
        {plan.derivations.length === 0 ? (
          <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">
            No calculated values.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Expression</TableHead>
                <TableHead className="text-right">Sample</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.derivations.map((d) => (
                <TableRow
                  key={d.id}
                  onClick={() => select("derivations", d.id)}
                  className={rowClass(d.id === selectedDerivation?.id)}
                >
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className="font-medium">{d.label || d.id}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        derived.{d.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-96 truncate">
                    <Code>{d.expression || "—"}</Code>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <SampleValue plan={plan} id={d.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selectedDerivation && (
        <DerivationEditor
          key={selectedDerivation.id}
          derivation={selectedDerivation}
          schema={expressionSchema}
          plan={plan}
          readOnly={readOnly}
          onChange={(next) => {
            save({
              ...plan,
              derivations: plan.derivations.map((d) => (d.id === selectedDerivation.id ? next : d)),
            });

            if (next.id !== selectedDerivation.id && KEY.test(next.id))
              select("derivations", next.id);
          }}
          onRemove={() => {
            save(
              {
                ...plan,
                derivations: plan.derivations.filter((d) => d.id !== selectedDerivation.id),
              },
              true,
            );

            clear();
          }}
        />
      )}

      <Panel
        title="Transforms"
        description="Custom code that reshapes provider data before it's stored and used. Runs as a sandboxed extension."
        action={addButton("Add transform", add.transform)}
        flush
      >
        {plan.transforms.length === 0 ? (
          <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">No transforms.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transform</TableHead>
                <TableHead>Extension</TableHead>
                <TableHead>Writes</TableHead>
                <TableHead>If it fails</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.transforms.map((t) => (
                <TableRow
                  key={t.id}
                  onClick={() => select("transforms", t.id)}
                  className={rowClass(t.id === selectedTransform?.id)}
                >
                  <TableCell className="font-mono text-xs">{t.id}</TableCell>
                  <TableCell>
                    {t.extension.key || <span className="text-muted-foreground">None</span>}
                    {t.extension.version && (
                      <span className="text-muted-foreground"> @{t.extension.version}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.writes.join(", ")}</TableCell>
                  <TableCell>
                    {t.onFailure === "block" ? "Stop the quote" : "Continue without it"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selectedTransform && (
        <TransformEditor
          key={selectedTransform.id}
          transform={selectedTransform}
          sources={sources}
          readOnly={readOnly}
          onChange={(next) => {
            save({
              ...plan,
              transforms: plan.transforms.map((t) => (t.id === selectedTransform.id ? next : t)),
            });

            if (next.id !== selectedTransform.id && KEY.test(next.id))
              select("transforms", next.id);
          }}
          onRemove={() => {
            save(
              { ...plan, transforms: plan.transforms.filter((t) => t.id !== selectedTransform.id) },
              true,
            );

            clear();
          }}
        />
      )}

      <Panel
        title="Mappings"
        description="Where data lands on the risk. Rating, rules and documents read these fields; values the user entered are never replaced."
        action={addButton("Add mapping", add.mapping)}
        flush
      >
        {plan.mappings.length === 0 ? (
          <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">No mappings.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To risk field</TableHead>
                <TableHead>Mode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.mappings.map((m, i) => (
                <TableRow
                  key={i}
                  onClick={() => select("mappings", String(i))}
                  className={rowClass(i === mappingIndex)}
                >
                  <TableCell>
                    {sources.find((s) => s.ref === m.from)?.label ?? <Code>{m.from}</Code>}
                  </TableCell>
                  <TableCell>
                    <Code>{m.to || "—"}</Code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{MODE_LABELS[m.mode]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selectedMapping && (
        <MappingEditor
          key={mappingIndex}
          mapping={selectedMapping}
          sources={sources}
          schema={contents.riskSchema}
          readOnly={readOnly}
          onChange={(next) =>
            save({
              ...plan,
              mappings: plan.mappings.map((m, i) => (i === mappingIndex ? next : m)),
            })
          }
          onRemove={() => {
            save({ ...plan, mappings: plan.mappings.filter((_, i) => i !== mappingIndex) }, true);
            clear();
          }}
        />
      )}

      <Panel
        title="Reports"
        description="Documents kept with the quote, from the provider or generated from a data report template."
        action={addButton("Add report", add.report)}
        flush
      >
        {plan.reports.length === 0 ? (
          <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">No reports.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.reports.map((r) => (
                <TableRow
                  key={r.id}
                  onClick={() => select("reports", r.id)}
                  className={rowClass(r.id === selectedReport?.id)}
                >
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell>{REPORT_SOURCE_LABELS[r.source]}</TableCell>
                  <TableCell>{STAGE_LABELS[r.stage]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selectedReport && (
        <ReportEditor
          key={selectedReport.id}
          report={selectedReport}
          calls={allCalls(plan).map((c) => c.call)}
          templates={contents.documents.templates
            .filter((t) => t.kind === "enrichment_report")
            .map((t) => ({ key: t.key, title: t.title }))}
          readOnly={readOnly}
          onChange={(next) => {
            save({
              ...plan,
              reports: plan.reports.map((r) => (r.id === selectedReport.id ? next : r)),
            });

            if (next.id !== selectedReport.id && KEY.test(next.id)) select("reports", next.id);
          }}
          onRemove={() => {
            save(
              { ...plan, reports: plan.reports.filter((r) => r.id !== selectedReport.id) },
              true,
            );

            clear();
          }}
        />
      )}
    </PageBody>
  );
}

const rowClass = (selected: boolean) =>
  cn("cursor-pointer", selected ? "bg-primary/5" : "hover:bg-muted/40");

function SampleValue({ plan, id }: { plan: EnrichmentPlan; id: string }) {
  const ready = useExpressionsReady();

  const value = useMemo(
    () => (ready ? sampleSources(plan).derived[id] : undefined),
    [ready, plan, id],
  );

  if (value === undefined || value === null)
    return <span className="text-muted-foreground">—</span>;

  return <>{typeof value === "number" ? value.toLocaleString("en-US") : String(value)}</>;
}

function EditorPanel({
  title,
  readOnly,
  onRemove,
  children,
}: {
  title: string;
  readOnly: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <Panel
      title={title}
      action={
        !readOnly && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 /> Remove
          </Button>
        )
      }
    >
      <fieldset disabled={readOnly} className="m-0 grid gap-5 border-0 p-0 sm:grid-cols-2">
        {children}
      </fieldset>
    </Panel>
  );
}

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-2", wide && "sm:col-span-2")}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <p className="m-0 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const stageOptions = enrichmentStages.map((s) => ({ value: s, label: STAGE_LABELS[s] }));
const modeOptions = enrichmentModes.map((m) => ({ value: m, label: MODE_LABELS[m] }));

function CallEditor({
  stage,
  call,
  schema,
  providers,
  readOnly,
  onChange,
  onRemove,
}: {
  stage: EnrichmentStage;
  call: EnrichmentCall;
  schema: RiskSchema;
  providers: { id: string; name: string; capabilities: readonly string[] }[];
  readOnly: boolean;
  onChange: (stage: EnrichmentStage, call: EnrichmentCall) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const update = (patch: Partial<EnrichmentCall>) => onChange(stage, { ...call, ...patch });
  const capable = providers.filter((p) => p.capabilities.includes(call.capability));
  const requestFields = CAPABILITY_REQUEST_FIELDS[call.capability];

  const move = (index: number, by: number) => {
    const next = [...call.providers];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    update({ providers: next });
  };

  return (
    <EditorPanel title={CAPABILITY_LABELS[call.capability]} readOnly={readOnly} onRemove={onRemove}>
      <Field label="Key" hint="How mappings and reports refer to it: call.<key>.<field>.">
        <Input
          id={`${id}-key`}
          className="font-mono"
          value={call.id}
          aria-invalid={!KEY.test(call.id)}
          onChange={(e) => update({ id: e.target.value })}
        />
      </Field>
      <Field label="Data">
        <Choice
          label="Data"
          value={call.capability}
          options={providerCapabilities.map((c) => ({ value: c, label: CAPABILITY_LABELS[c] }))}
          onChange={(capability) =>
            update({ capability, providers: [], request: {}, response: {} })
          }
        />
      </Field>
      <Field label="When" hint="Prefill runs as the risk is entered; before rating runs at quote.">
        <Choice
          label="When"
          value={stage}
          options={stageOptions}
          onChange={(s) => onChange(s, call)}
        />
      </Field>
      <Field label="Mode">
        <Choice
          label="Mode"
          value={call.mode}
          options={modeOptions}
          onChange={(mode) => update({ mode })}
        />
      </Field>

      <Field label="Providers" hint="Asked in this order; the next answers when one fails." wide>
        <div className="grid gap-2">
          {capable.length === 0 && (
            <p className="m-0 text-sm text-muted-foreground">
              No enabled provider supplies this. Enable one in Settings → Integrations.
            </p>
          )}
          {call.providers.map((providerId, i) => (
            <div key={providerId} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <span className="flex-1 text-sm">
                {providers.find((p) => p.id === providerId)?.name ?? providerId}
              </span>
              {!readOnly && (
                <>
                  <IconAction label="Move up" icon={ArrowUp} onClick={() => i > 0 && move(i, -1)} />
                  <IconAction
                    label="Move down"
                    icon={ArrowDown}
                    onClick={() => i < call.providers.length - 1 && move(i, 1)}
                  />
                  <IconAction
                    label="Remove provider"
                    icon={X}
                    onClick={() =>
                      update({ providers: call.providers.filter((p) => p !== providerId) })
                    }
                  />
                </>
              )}
            </div>
          ))}
          {!readOnly &&
            capable
              .filter((p) => !call.providers.includes(p.id))
              .map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={false}
                    onCheckedChange={() => update({ providers: [...call.providers, p.id] })}
                  />
                  Add {p.name}
                </label>
              ))}
          {call.providers.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={call.combine === "merge"}
                onCheckedChange={(on) => update({ combine: on === true ? "merge" : "fallback" })}
              />
              Ask every provider and merge their answers field by field
            </label>
          )}
        </div>
      </Field>

      <Field
        label="Request"
        hint="The risk fields sent to the provider. The call waits until every field that isn't optional has a value."
        wide
      >
        <div className="grid gap-2">
          {requestFields.map((field) => (
            <div
              key={field}
              className="grid grid-cols-[10rem_minmax(0,1fr)_6rem_2rem] items-center gap-2"
            >
              <span className="font-mono text-xs">{field}</span>
              <PathPicker
                schema={schema}
                value={call.request[field] ?? ""}
                bound={new Set()}
                onChange={(path) => update({ request: { ...call.request, [field]: path } })}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={call.optional.includes(field)}
                  disabled={!call.request[field]}
                  onCheckedChange={(on) =>
                    update({
                      optional:
                        on === true
                          ? [...call.optional, field]
                          : call.optional.filter((f) => f !== field),
                    })
                  }
                />
                Optional
              </label>
              {call.request[field] && !readOnly ? (
                <IconAction
                  label={`Clear ${field}`}
                  icon={X}
                  onClick={() => {
                    const { [field]: _, ...rest } = call.request;
                    update({ request: rest });
                  }}
                />
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </Field>

      <Field
        label="Cache for"
        hint="ISO duration, e.g. P30D. Repeat quotes at an address reuse the answer."
      >
        <Input
          className="font-mono"
          value={call.cacheTtl ?? ""}
          onChange={(e) => {
            const { cacheTtl: _, ...rest } = call;
            onChange(stage, e.target.value ? { ...rest, cacheTtl: e.target.value } : rest);
          }}
        />
      </Field>
      <Field label="Timeout (ms)">
        <Input
          type="number"
          className="tabular-nums"
          value={call.timeoutMs}
          onChange={(e) => update({ timeoutMs: Math.max(100, Number(e.target.value) || 0) })}
        />
      </Field>
      <Field label="Cost">
        <Choice
          label="Cost"
          value={call.costClass}
          options={costClasses.map((c) => ({
            value: c,
            label: c.charAt(0).toUpperCase() + c.slice(1),
          }))}
          onChange={(costClass) => update({ costClass })}
        />
      </Field>
      <Field label="Answers" hint="Fields this source supplies; map them to the risk below.">
        <p className="m-0 text-sm text-muted-foreground">
          {CAPABILITY_FIELDS[call.capability].map((f) => f.label).join(", ")}
        </p>
      </Field>
    </EditorPanel>
  );
}

function DerivationEditor({
  derivation,
  schema,
  plan,
  readOnly,
  onChange,
  onRemove,
}: {
  derivation: EnrichmentDerivation;
  schema: RiskSchema;
  plan: EnrichmentPlan;
  readOnly: boolean;
  onChange: (next: EnrichmentDerivation) => void;
  onRemove: () => void;
}) {
  const ready = useExpressionsReady();

  const trial = useMemo(() => {
    if (!ready || !derivation.expression.trim()) return null;

    const sources = sampleSources(plan);

    try {
      return { value: evaluate(derivation.expression, { ...sources }) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  }, [ready, plan, derivation.expression]);

  return (
    <EditorPanel title={derivation.label || derivation.id} readOnly={readOnly} onRemove={onRemove}>
      <Field label="Key" hint="Read it as derived.<key>.">
        <Input
          className="font-mono"
          value={derivation.id}
          aria-invalid={!KEY.test(derivation.id)}
          onChange={(e) => onChange({ ...derivation, id: e.target.value })}
        />
      </Field>
      <Field label="Label">
        <Input
          value={derivation.label ?? ""}
          onChange={(e) => onChange({ ...derivation, label: e.target.value })}
        />
      </Field>
      <Field label="When">
        <Choice
          label="When"
          value={derivation.stage}
          options={stageOptions}
          onChange={(stage) => onChange({ ...derivation, stage })}
        />
      </Field>
      <Field label="Format">
        <Choice
          label="Format"
          value={derivation.kind ?? "number"}
          options={derivationKinds.map((k) => ({
            value: k,
            label: k.charAt(0).toUpperCase() + k.slice(1),
          }))}
          onChange={(kind) => onChange({ ...derivation, kind })}
        />
      </Field>
      <div className="grid gap-2 sm:col-span-2">
        <span className="text-sm font-medium">Expression</span>
        <ExpressionInput
          value={derivation.expression}
          onChange={(expression) => onChange({ ...derivation, expression })}
          schema={schema}
          hint="Reads call.*, transform.*, earlier derived.* values and risk.*, e.g. call.rce.replacementCost * 1.1"
        />
        {trial && (
          <p
            className={cn(
              "m-0 text-xs tabular-nums",
              "error" in trial ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {"error" in trial
              ? trial.error
              : `With sample data: ${typeof trial.value === "number" ? trial.value.toLocaleString("en-US") : JSON.stringify(trial.value)}`}
          </p>
        )}
      </div>
    </EditorPanel>
  );
}

function TransformEditor({
  transform,
  sources,
  readOnly,
  onChange,
  onRemove,
}: {
  transform: EnrichmentTransform;
  sources: { ref: string; label: string }[];
  readOnly: boolean;
  onChange: (next: EnrichmentTransform) => void;
  onRemove: () => void;
}) {
  const reads = new Set(transform.reads);
  const trpc = useTRPC();

  const choices = useQuery(
    trpc.extensions.versionChoices.queryOptions({ point: "enrichment_transform" }),
  );

  const keys = [...new Map((choices.data ?? []).map((c) => [c.key, c.name])).entries()];
  const current = transform.extension.key;

  return (
    <EditorPanel title={transform.id} readOnly={readOnly} onRemove={onRemove}>
      <Field label="Key" hint="Read its output as transform.<key>.<field>.">
        <Input
          className="font-mono"
          value={transform.id}
          aria-invalid={!KEY.test(transform.id)}
          onChange={(e) => onChange({ ...transform, id: e.target.value })}
        />
      </Field>
      <Field
        label="Extension"
        hint="A published extension with the enrichment transform point. Its latest version is pinned when you publish."
      >
        <Select
          value={current}
          onValueChange={(key) => onChange({ ...transform, extension: { key } })}
          disabled={readOnly}
        >
          <SelectTrigger aria-label="Extension">
            <SelectValue placeholder="Choose an extension" />
          </SelectTrigger>
          <SelectContent>
            {current && !keys.some(([key]) => key === current) && (
              <SelectItem value={current} description="Not published">
                {current}
              </SelectItem>
            )}
            {keys.map(([key, name]) => (
              <SelectItem key={key} value={key} description={key}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="When">
        <Choice
          label="When"
          value={transform.stage}
          options={stageOptions}
          onChange={(stage) => onChange({ ...transform, stage })}
        />
      </Field>
      <Field label="If it fails">
        <Choice
          label="If it fails"
          value={transform.onFailure}
          options={[
            { value: "block", label: "Stop the quote" },
            { value: "skip", label: "Continue without it" },
          ]}
          onChange={(onFailure) => onChange({ ...transform, onFailure })}
        />
      </Field>
      <Field label="Writes" hint="Comma-separated field names it returns." wide>
        <Input
          className="font-mono"
          value={transform.writes.join(", ")}
          onChange={(e) =>
            onChange({
              ...transform,
              writes: e.target.value
                .split(",")
                .map((w) => w.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Field label="Reads" hint="The data passed to the extension." wide>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {sources
            .filter((s) => !s.ref.startsWith(`transform.${transform.id}.`))
            .map((s) => (
              <label key={s.ref} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={reads.has(s.ref)}
                  onCheckedChange={(on) =>
                    onChange({
                      ...transform,
                      reads:
                        on === true
                          ? [...transform.reads, s.ref]
                          : transform.reads.filter((r) => r !== s.ref),
                    })
                  }
                />
                {s.label}
              </label>
            ))}
        </div>
      </Field>
    </EditorPanel>
  );
}

function MappingEditor({
  mapping,
  sources,
  schema,
  readOnly,
  onChange,
  onRemove,
}: {
  mapping: EnrichmentMapping;
  sources: { ref: string; label: string }[];
  schema: RiskSchema;
  readOnly: boolean;
  onChange: (next: EnrichmentMapping) => void;
  onRemove: () => void;
}) {
  return (
    <EditorPanel title="Mapping" readOnly={readOnly} onRemove={onRemove}>
      <Field label="From">
        <Choice
          label="From"
          value={mapping.from || undefined}
          options={sources.map((s) => ({ value: s.ref, label: s.label }))}
          onChange={(from) => onChange({ ...mapping, from })}
        />
      </Field>
      <Field label="To risk field">
        <PathPicker
          schema={schema}
          value={mapping.to}
          bound={new Set()}
          onChange={(to) => onChange({ ...mapping, to })}
        />
      </Field>
      <Field
        label="Mode"
        hint="Underwriting-only values are stored and shown to underwriters but never written to the risk."
        wide
      >
        <Choice
          label="Mode"
          value={mapping.mode}
          options={modeOptions}
          onChange={(mode) => onChange({ ...mapping, mode })}
        />
      </Field>
    </EditorPanel>
  );
}

function ReportEditor({
  report,
  calls,
  templates,
  readOnly,
  onChange,
  onRemove,
}: {
  report: EnrichmentReport;
  calls: EnrichmentCall[];
  templates: { key: string; title: string }[];
  readOnly: boolean;
  onChange: (next: EnrichmentReport) => void;
  onRemove: () => void;
}) {
  return (
    <EditorPanel title={report.title} readOnly={readOnly} onRemove={onRemove}>
      <Field label="Title">
        <Input
          value={report.title}
          onChange={(e) => onChange({ ...report, title: e.target.value })}
        />
      </Field>
      <Field label="Key">
        <Input
          className="font-mono"
          value={report.id}
          aria-invalid={!KEY.test(report.id)}
          onChange={(e) => onChange({ ...report, id: e.target.value })}
        />
      </Field>
      <Field label="Source">
        <Choice
          label="Source"
          value={report.source}
          options={reportSources.map((s) => ({ value: s, label: REPORT_SOURCE_LABELS[s] }))}
          onChange={(source) => onChange({ ...report, source })}
        />
      </Field>
      <Field label="When">
        <Choice
          label="When"
          value={report.stage}
          options={stageOptions}
          onChange={(stage) => onChange({ ...report, stage })}
        />
      </Field>
      {report.source !== "template" && (
        <Field label="Provider's report from">
          <Choice
            label="Provider's report from"
            value={report.callId}
            options={calls.map((c) => ({
              value: c.id,
              label: `${CAPABILITY_LABELS[c.capability]} (${c.id})`,
            }))}
            onChange={(callId) => onChange({ ...report, callId })}
          />
        </Field>
      )}
      {report.source !== "vendor" && (
        <Field
          label="Template"
          hint={
            templates.length === 0
              ? "Add a template of type Data report in Documents first."
              : undefined
          }
        >
          <Choice
            label="Template"
            value={report.template}
            options={templates.map((t) => ({ value: t.key, label: t.title }))}
            onChange={(template) => onChange({ ...report, template })}
          />
        </Field>
      )}
    </EditorPanel>
  );
}

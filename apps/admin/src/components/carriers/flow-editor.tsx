import { Button } from "@pas/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { cn } from "@pas/ui/lib/utils";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { type Flow, newStep, STEP_KINDS, type Step, stepKindLabel } from "./labels";
import { MappingEditor } from "./mapping-editor";

type HttpCall = Omit<Extract<Step, { kind: "request" }>, "kind" | "id" | "name">;
type Issue = { severity: string; message: string; step?: string; field?: string };

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function Row({
  label,
  id,
  children,
  hint,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </Label>
      {children}
    </div>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  readOnly?: boolean;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      className="tabular-nums"
      value={value ?? ""}
      readOnly={readOnly}
      onChange={(event) =>
        onChange(event.target.value === "" ? undefined : Number(event.target.value))
      }
    />
  );
}

function Pairs({
  id,
  value,
  onChange,
  context,
  readOnly,
}: {
  id: string;
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
  context: Record<string, unknown> | null;
  readOnly?: boolean;
}) {
  const entries = Object.entries(value ?? {});

  const write = (next: [string, string][]) =>
    onChange(next.length ? Object.fromEntries(next) : undefined);

  return (
    <div className="grid gap-2">
      {entries.map(([name, template], i) => (
        <div key={i} className="grid grid-cols-[10rem_minmax(0,1fr)_auto] items-start gap-2">
          <Input
            aria-label="Header name"
            value={name}
            readOnly={readOnly}
            className="font-mono text-xs"
            onChange={(e) =>
              write(entries.map((entry, j) => (j === i ? [e.target.value, entry[1]] : entry)))
            }
          />
          <MappingEditor
            id={`${id}-${i}`}
            template
            value={template}
            context={context}
            readOnly={readOnly}
            onChange={(next) =>
              write(entries.map((entry, j) => (j === i ? [entry[0], next] : entry)))
            }
          />
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove header"
              onClick={() => write(entries.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => write([...entries, ["", ""]])}
        >
          <Plus /> Add header
        </Button>
      )}
    </div>
  );
}

function CallFields({
  prefix,
  call,
  onChange,
  context,
  readOnly,
  full,
}: {
  prefix: string;
  call: HttpCall;
  onChange: (next: HttpCall) => void;
  context: Record<string, unknown> | null;
  readOnly?: boolean;
  full?: boolean;
}) {
  const set = <K extends keyof HttpCall>(key: K, value: HttpCall[K]) => {
    const next = { ...call, [key]: value };

    if (value === undefined || value === "") delete next[key];

    onChange(next);
  };

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
        <Row label="Method" id={`${prefix}-method`}>
          <Select
            value={call.method}
            onValueChange={(v) => set("method", v as HttpCall["method"])}
            disabled={readOnly}
          >
            <SelectTrigger id={`${prefix}-method`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Path" id={`${prefix}-path`}>
          <MappingEditor
            id={`${prefix}-path`}
            template
            value={call.path}
            onChange={(v) => set("path", v)}
            context={context}
            readOnly={readOnly}
          />
        </Row>
      </div>
      <Row label="Headers" id={`${prefix}-headers`} hint="Optional">
        <Pairs
          id={`${prefix}-headers`}
          value={call.headers}
          onChange={(v) => set("headers", v)}
          context={context}
          readOnly={readOnly}
        />
      </Row>
      {call.method !== "GET" && (
        <Row label="Body mapping" id={`${prefix}-body`} hint="Optional">
          <MappingEditor
            id={`${prefix}-body`}
            value={call.body ?? ""}
            onChange={(v) => set("body", v)}
            context={context}
            rows={4}
            readOnly={readOnly}
            placeholder="{ applicant: { name: input.insured.name } }"
          />
        </Row>
      )}
      {full && (
        <>
          <Row label="Response mapping" id={`${prefix}-response`} hint="Optional">
            <MappingEditor
              id={`${prefix}-response`}
              value={call.response ?? ""}
              onChange={(v) => set("response", v)}
              context={context}
              readOnly={readOnly}
              placeholder="{ id: response.applicationId }"
            />
          </Row>
          <Row label="Success when" id={`${prefix}-success`} hint="Default: any 2xx status">
            <MappingEditor
              id={`${prefix}-success`}
              value={call.success ?? ""}
              onChange={(v) => set("success", v)}
              context={context}
              rows={1}
              readOnly={readOnly}
              placeholder="status == 201"
            />
          </Row>
          <Row label="Error messages" id={`${prefix}-errors`} hint="Optional">
            <div className="grid gap-2">
              {(call.errors ?? []).map((mapping, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-2"
                >
                  <MappingEditor
                    id={`${prefix}-err-${i}`}
                    value={mapping.when}
                    rows={1}
                    context={null}
                    readOnly={readOnly}
                    onChange={(v) =>
                      set(
                        "errors",
                        (call.errors ?? []).map((m, j) => (j === i ? { ...m, when: v } : m)),
                      )
                    }
                  />
                  <MappingEditor
                    id={`${prefix}-errmsg-${i}`}
                    template
                    value={mapping.message}
                    context={null}
                    readOnly={readOnly}
                    onChange={(v) =>
                      set(
                        "errors",
                        (call.errors ?? []).map((m, j) => (j === i ? { ...m, message: v } : m)),
                      )
                    }
                  />
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove error mapping"
                      onClick={() =>
                        set(
                          "errors",
                          (call.errors ?? []).filter((_, j) => j !== i),
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() =>
                    set("errors", [
                      ...(call.errors ?? []),
                      { when: "status == 422", message: "{{ body.message }}" },
                    ])
                  }
                >
                  <Plus /> Add error message
                </Button>
              )}
            </div>
          </Row>
          <div className="grid gap-3 sm:grid-cols-4">
            <Row label="Idempotency key" id={`${prefix}-idem`} hint="Optional">
              <MappingEditor
                id={`${prefix}-idem`}
                template
                value={call.idempotencyKey ?? ""}
                onChange={(v) => set("idempotencyKey", v)}
                context={context}
                readOnly={readOnly}
              />
            </Row>
            <Row label="Attempts" id={`${prefix}-attempts`}>
              <NumberInput
                id={`${prefix}-attempts`}
                value={call.retry?.attempts}
                readOnly={readOnly}
                onChange={(v) =>
                  set(
                    "retry",
                    v === undefined
                      ? undefined
                      : { backoff: "exponential", delaySeconds: 2, ...call.retry, attempts: v },
                  )
                }
              />
            </Row>
            <Row label="Backoff seconds" id={`${prefix}-delay`}>
              <NumberInput
                id={`${prefix}-delay`}
                value={call.retry?.delaySeconds}
                readOnly={readOnly}
                onChange={(v) =>
                  set(
                    "retry",
                    v === undefined
                      ? undefined
                      : { attempts: 3, backoff: "exponential", ...call.retry, delaySeconds: v },
                  )
                }
              />
            </Row>
            <Row label="Timeout ms" id={`${prefix}-timeout`}>
              <NumberInput
                id={`${prefix}-timeout`}
                value={call.timeoutMs}
                readOnly={readOnly}
                onChange={(v) => set("timeoutMs", v)}
              />
            </Row>
          </div>
        </>
      )}
    </div>
  );
}

function StepForm({
  step,
  ids,
  onChange,
  context,
  readOnly,
}: {
  step: Step;
  ids: string[];
  onChange: (next: Step) => void;
  context: Record<string, unknown> | null;
  readOnly?: boolean;
}) {
  const prefix = `step-${step.id}`;

  const scope = {
    ...context,
    response: (context?.steps as Record<string, { body?: unknown }> | undefined)?.[step.id]?.body,
  };

  const targets = [...ids.filter((id) => id !== step.id), "end"];

  const header = (
    <div className="grid gap-3 sm:grid-cols-2">
      <Row label="Step id" id={`${prefix}-id`}>
        <Input
          id={`${prefix}-id`}
          value={step.id}
          readOnly={readOnly}
          className="font-mono text-xs"
          onChange={(e) => onChange({ ...step, id: e.target.value })}
        />
      </Row>
      <Row label="Name" id={`${prefix}-name`} hint="Optional">
        <Input
          id={`${prefix}-name`}
          value={step.name ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange({ ...step, name: e.target.value || undefined })}
        />
      </Row>
    </div>
  );

  const body = (() => {
    switch (step.kind) {
      case "request": {
        const { kind: _k, id: _i, name: _n, ...call } = step;

        return (
          <CallFields
            prefix={prefix}
            call={call}
            full
            context={scope}
            readOnly={readOnly}
            onChange={(next) =>
              onChange({
                kind: "request",
                id: step.id,
                ...(step.name && { name: step.name }),
                ...next,
              })
            }
          />
        );
      }
      case "compensate":
        return (
          <CallFields
            prefix={prefix}
            call={step.request}
            context={context}
            readOnly={readOnly}
            onChange={(request) => onChange({ ...step, request })}
          />
        );
      case "poll":
        return (
          <div className="grid gap-4">
            <CallFields
              prefix={prefix}
              call={step.request}
              context={context}
              readOnly={readOnly}
              onChange={(request) => onChange({ ...step, request })}
            />
            <Row label="Until" id={`${prefix}-until`}>
              <MappingEditor
                id={`${prefix}-until`}
                value={step.until}
                rows={1}
                context={scope}
                readOnly={readOnly}
                onChange={(until) => onChange({ ...step, until })}
              />
            </Row>
            <div className="grid gap-3 sm:grid-cols-4">
              <Row label="Every (s)" id={`${prefix}-interval`}>
                <NumberInput
                  id={`${prefix}-interval`}
                  value={step.intervalSeconds}
                  readOnly={readOnly}
                  onChange={(v) => onChange({ ...step, intervalSeconds: v ?? 1 })}
                />
              </Row>
              <Row label="Backoff ×" id={`${prefix}-factor`}>
                <NumberInput
                  id={`${prefix}-factor`}
                  value={step.backoffFactor}
                  readOnly={readOnly}
                  onChange={(v) => onChange({ ...step, backoffFactor: v ?? 1 })}
                />
              </Row>
              <Row label="At most every (s)" id={`${prefix}-max-interval`}>
                <NumberInput
                  id={`${prefix}-max-interval`}
                  value={step.maxIntervalSeconds}
                  readOnly={readOnly}
                  onChange={(v) => onChange({ ...step, maxIntervalSeconds: v ?? 1 })}
                />
              </Row>
              <Row label="Give up after (s)" id={`${prefix}-max-wait`}>
                <NumberInput
                  id={`${prefix}-max-wait`}
                  value={step.maxWaitSeconds}
                  readOnly={readOnly}
                  onChange={(v) => onChange({ ...step, maxWaitSeconds: v ?? 60 })}
                />
              </Row>
            </div>
          </div>
        );
      case "await_callback":
        return (
          <div className="grid gap-4">
            <Row label="Correlation key" id={`${prefix}-corr`}>
              <MappingEditor
                id={`${prefix}-corr`}
                template
                value={step.correlation}
                context={context}
                readOnly={readOnly}
                onChange={(correlation) => onChange({ ...step, correlation })}
              />
            </Row>
            <Row label="Only wait when" id={`${prefix}-when`} hint="Optional">
              <MappingEditor
                id={`${prefix}-when`}
                value={step.when ?? ""}
                rows={1}
                context={context}
                readOnly={readOnly}
                onChange={(when) => onChange({ ...step, when: when || undefined })}
              />
            </Row>
            <Row label="Callback mapping" id={`${prefix}-response`} hint="Optional">
              <MappingEditor
                id={`${prefix}-response`}
                value={step.response ?? ""}
                context={null}
                readOnly={readOnly}
                placeholder="{ status: callback.decision }"
                onChange={(response) => onChange({ ...step, response: response || undefined })}
              />
            </Row>
            <Row label="Time out after (s)" id={`${prefix}-timeout`}>
              <NumberInput
                id={`${prefix}-timeout`}
                value={step.timeoutSeconds}
                readOnly={readOnly}
                onChange={(v) => onChange({ ...step, timeoutSeconds: v ?? 3600 })}
              />
            </Row>
          </div>
        );
      case "branch":
        return (
          <div className="grid gap-3">
            {step.cases.map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_10rem_auto] items-start gap-2">
                <MappingEditor
                  id={`${prefix}-case-${i}`}
                  value={c.when}
                  rows={1}
                  context={context}
                  readOnly={readOnly}
                  onChange={(when) =>
                    onChange({
                      ...step,
                      cases: step.cases.map((x, j) => (j === i ? { ...x, when } : x)),
                    })
                  }
                />
                <Target
                  value={c.goto}
                  targets={targets}
                  readOnly={readOnly}
                  onChange={(goto) =>
                    onChange({
                      ...step,
                      cases: step.cases.map((x, j) => (j === i ? { ...x, goto } : x)),
                    })
                  }
                />
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove case"
                    onClick={() =>
                      onChange({ ...step, cases: step.cases.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() =>
                  onChange({ ...step, cases: [...step.cases, { when: "true", goto: "end" }] })
                }
              >
                <Plus /> Add case
              </Button>
            )}
            <Row label="Otherwise" id={`${prefix}-otherwise`}>
              <Target
                value={step.otherwise ?? "next"}
                targets={["next", ...targets]}
                readOnly={readOnly}
                onChange={(v) => onChange({ ...step, otherwise: v === "next" ? undefined : v })}
              />
            </Row>
          </div>
        );
      case "map":
        return (
          <Row label="Expression" id={`${prefix}-expr`}>
            <MappingEditor
              id={`${prefix}-expr`}
              value={step.expression}
              rows={4}
              context={context}
              readOnly={readOnly}
              onChange={(expression) => onChange({ ...step, expression })}
            />
          </Row>
        );
      case "fail":
        return (
          <Row label="Message" id={`${prefix}-message`}>
            <MappingEditor
              id={`${prefix}-message`}
              template
              value={step.message}
              context={context}
              readOnly={readOnly}
              onChange={(message) => onChange({ ...step, message })}
            />
          </Row>
        );
    }
  })();

  return (
    <div className="grid gap-5">
      {header}
      {body}
    </div>
  );
}

function Target({
  value,
  targets,
  onChange,
  readOnly,
}: {
  value: string;
  targets: string[];
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={readOnly}>
      <SelectTrigger aria-label="Go to">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {targets.map((t) => (
          <SelectItem key={t} value={t}>
            {t === "end" ? "End the flow" : t === "next" ? "Next step" : t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The ordered steps of one capability, a form per step kind, and the output mapping. */
export function FlowEditor({
  flow,
  onChange,
  context,
  issues,
  readOnly,
}: {
  flow: Flow;
  onChange: (next: Flow) => void;
  context: Record<string, unknown> | null;
  issues: Issue[];
  readOnly?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, flow.steps.length - 1);
  const step = flow.steps[index];
  const ids = flow.steps.map((s) => s.id);

  const setSteps = (steps: Step[]) => onChange({ ...flow, steps });

  const move = (from: number, to: number) => {
    const steps = [...flow.steps];
    const [item] = steps.splice(from, 1);

    steps.splice(to, 0, item!);
    setSteps(steps);
    setSelected(to);
  };

  const add = (kind: Step["kind"]) => {
    let n = flow.steps.length + 1;

    while (ids.includes(`${kind}_${n}`)) n++;

    setSteps([...flow.steps, newStep(kind, `${kind}_${n}`)]);
    setSelected(flow.steps.length);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Panel
        flush
        title="Steps"
        action={
          !readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus /> Add step
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {STEP_KINDS.map((kind) => (
                  <DropdownMenuItem key={kind.value} onSelect={() => add(kind.value)}>
                    <span className="grid">
                      <span className="text-sm font-medium">{kind.label}</span>
                      <span className="text-xs text-muted-foreground">{kind.description}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      >
        <ol className="m-0 list-none divide-y p-0">
          {flow.steps.map((s, i) => {
            const problems = issues.filter((issue) => issue.step === s.id).length;

            return (
              <li key={`${s.id}-${i}`}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className={cn(
                    "flex w-full items-center gap-3 px-(--card-p) py-3 text-left hover:bg-muted/40",
                    i === index && "bg-primary/5",
                  )}
                >
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm leading-5 font-medium">{s.name || s.id}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {stepKindLabel(s.kind)}
                      {"method" in s
                        ? ` · ${s.method} ${s.path}`
                        : "request" in s
                          ? ` · ${s.request.method} ${s.request.path}`
                          : ""}
                    </span>
                  </span>
                  {problems > 0 && (
                    <span
                      aria-label={`${problems} problems`}
                      className="size-1.5 shrink-0 rounded-full bg-red-500"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </Panel>
      <div className="grid content-start gap-6">
        {step ? (
          <Panel
            title={step.name || step.id}
            description={STEP_KINDS.find((k) => k.value === step.kind)?.description}
            action={
              !readOnly && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    disabled={index === flow.steps.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete step"
                    onClick={() => setSteps(flow.steps.filter((_, i) => i !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              )
            }
          >
            <div className="grid gap-4">
              {issues
                .filter((issue) => issue.step === step.id)
                .map((issue, i) => (
                  <p key={i} className="m-0 flex items-center gap-2 text-sm text-red-800">
                    <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
                    {issue.field ? `${issue.field}: ` : ""}
                    {issue.message}
                  </p>
                ))}
              <StepForm
                key={index}
                step={step}
                ids={ids}
                context={context}
                readOnly={readOnly}
                onChange={(next) => setSteps(flow.steps.map((s, i) => (i === index ? next : s)))}
              />
            </div>
          </Panel>
        ) : (
          <Panel title="No steps yet">
            <p className="m-0 text-sm text-muted-foreground">
              Add the first request to the carrier.
            </p>
          </Panel>
        )}
        <Panel
          title="Output"
          description="Maps the flow into the canonical outcome: status, reference, policy number, premium, documents and messages."
        >
          <MappingEditor
            id="flow-output"
            value={flow.output}
            rows={5}
            context={context}
            readOnly={readOnly}
            onChange={(output) => onChange({ ...flow, output })}
          />
        </Panel>
      </div>
    </div>
  );
}

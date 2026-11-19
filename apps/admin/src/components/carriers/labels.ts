import type { AdminOutputs } from "@pas/api-client";
import type { StatusTone } from "@pas/ui/components/status-chip";

export type CarrierDetail = AdminOutputs["carriers"]["get"];
export type ConnectorVersion = AdminOutputs["carriers"]["connector"]["get"];
export type Definition = ConnectorVersion["definition"];
export type Capability = NonNullable<keyof Definition["capabilities"]>;
export type Flow = NonNullable<Definition["capabilities"][Capability]>;
export type Step = Flow["steps"][number];
export type StepKind = Step["kind"];
export type FlowRun = AdminOutputs["carriers"]["runs"]["get"];

export const CAPABILITIES: { value: Capability; label: string; description: string }[] = [
  { value: "quote", label: "Quote", description: "Rate the risk and return the carrier's premium" },
  { value: "bind", label: "Bind", description: "Bind the carrier's quote" },
  { value: "issue", label: "Issue", description: "Issue the policy, its number and documents" },
  { value: "endorse", label: "Endorse", description: "Mid-term changes" },
  { value: "cancel", label: "Cancel", description: "Cancellations and return premium" },
  { value: "reinstate", label: "Reinstate", description: "Reinstatements" },
  { value: "documents", label: "Documents", description: "Fetch documents on demand" },
  { value: "status", label: "Status sync", description: "Reconcile the carrier's status" },
];

export const capabilityLabel = (value: string) =>
  CAPABILITIES.find((c) => c.value === value)?.label ?? value;

export const STEP_KINDS: { value: StepKind; label: string; description: string }[] = [
  { value: "request", label: "Request", description: "Call the carrier and map its response" },
  { value: "poll", label: "Poll", description: "Repeat a request until it settles" },
  {
    value: "await_callback",
    label: "Await callback",
    description: "Pause until the carrier calls back",
  },
  { value: "branch", label: "Branch", description: "Jump to a step on a condition" },
  { value: "map", label: "Map", description: "Transform data without calling anyone" },
  {
    value: "compensate",
    label: "Compensate",
    description: "Undo earlier steps if a later one fails",
  },
  { value: "fail", label: "Fail", description: "Stop the flow with a message" },
];

export const stepKindLabel = (kind: string) =>
  STEP_KINDS.find((k) => k.value === kind)?.label ?? kind;

export const MODES = {
  connector: "Configured connector",
  extension: "Extension adapter",
  file_feed: "File feeds",
} as const;

export const RUN_TONES: Record<string, StatusTone> = {
  running: "accent",
  waiting: "warning",
  succeeded: "success",
  failed: "danger",
};

export const runLabel = (status: string) =>
  ({ running: "Running", waiting: "Waiting on carrier", succeeded: "Succeeded", failed: "Failed" })[
    status
  ] ?? status;

export function newStep(kind: StepKind, id: string): Step {
  const call = { method: "POST" as const, path: "/" };

  switch (kind) {
    case "request":
      return { kind, id, ...call, response: "response" };
    case "poll":
      return {
        kind,
        id,
        request: { method: "GET", path: "/" },
        until: 'response.status != "pending"',
        intervalSeconds: 2,
        backoffFactor: 1.5,
        maxIntervalSeconds: 10,
        maxWaitSeconds: 120,
      };
    case "await_callback":
      return { kind, id, correlation: "{{ steps.submit.output.id }}", timeoutSeconds: 86_400 };
    case "branch":
      return { kind, id, cases: [{ when: "true", goto: "end" }] };
    case "map":
      return { kind, id, expression: "{ }" };
    case "compensate":
      return { kind, id, request: { method: "POST", path: "/" } };
    case "fail":
      return { kind, id, message: "The carrier refused" };
  }
}

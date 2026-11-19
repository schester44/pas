export const CAPABILITIES = [
  "quote",
  "bind",
  "issue",
  "endorse",
  "cancel",
  "reinstate",
  "documents",
  "status",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  quote: "Quote",
  bind: "Bind",
  issue: "Issue",
  endorse: "Endorse",
  cancel: "Cancel",
  reinstate: "Reinstate",
  documents: "Documents",
  status: "Status sync",
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RetryPolicy {
  attempts: number;
  backoff: "fixed" | "exponential";
  delaySeconds: number;
}

/** Maps a carrier error response to a message; `when` sees `status`, `body` and `headers`. */
export interface ErrorMapping {
  when: string;
  message: string;
  retry?: boolean;
}

/**
 * One HTTP call. `path`, header values and `idempotencyKey` are templates (`{{ expression }}`);
 * `body`, `response` and `success` are ZEN expressions over the flow context.
 */
export interface HttpCall {
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
  response?: string;
  success?: string;
  errors?: ErrorMapping[];
  idempotencyKey?: string;
  retry?: RetryPolicy;
  timeoutMs?: number;
  /** Skip the connection's credentials, e.g. on a token endpoint that takes them in the body. */
  anonymous?: boolean;
}

interface StepBase {
  id: string;
  name?: string;
}

export interface RequestStep extends StepBase, HttpCall {
  kind: "request";
}

export interface PollStep extends StepBase {
  kind: "poll";
  request: HttpCall;
  /** True once the polled resource is settled; sees `response`, `status` and the flow context. */
  until: string;
  intervalSeconds: number;
  backoffFactor: number;
  maxIntervalSeconds: number;
  maxWaitSeconds: number;
}

export interface AwaitCallbackStep extends StepBase {
  kind: "await_callback";
  /** Template for the key the carrier's callback carries (see `callbacks.correlation`). */
  correlation: string;
  timeoutSeconds: number;
  /** Only wait when this is true, e.g. `steps.submit.output.status == "pending"`. */
  when?: string;
  response?: string;
}

export interface BranchStep extends StepBase {
  kind: "branch";
  cases: { when: string; goto: string }[];
  /** A step id, or `end` to finish the flow. Omitted: continue with the next step. */
  otherwise?: string;
}

export interface MapStep extends StepBase {
  kind: "map";
  expression: string;
}

/** Armed once reached; runs (newest first) when a later step fails. */
export interface CompensateStep extends StepBase {
  kind: "compensate";
  request: HttpCall;
}

export interface FailStep extends StepBase {
  kind: "fail";
  message: string;
}

export type FlowStep =
  | RequestStep
  | PollStep
  | AwaitCallbackStep
  | BranchStep
  | MapStep
  | CompensateStep
  | FailStep;

export type StepKind = FlowStep["kind"];

export interface Flow {
  steps: FlowStep[];
  /** ZEN expression producing the canonical outcome (see `outcome.ts`). */
  output: string;
}

export interface ConnectorDefinition {
  defaults: {
    headers: Record<string, string>;
    timeoutMs: number;
    retry: RetryPolicy;
  };
  callbacks: {
    /** ZEN expression over `body` and `headers` giving the correlation key of an inbound callback. */
    correlation: string;
  };
  capabilities: Partial<Record<Capability, Flow>>;
}

export const NO_RETRY: RetryPolicy = { attempts: 1, backoff: "fixed", delaySeconds: 1 };

export function emptyConnector(): ConnectorDefinition {
  return {
    defaults: {
      headers: { "content-type": "application/json", accept: "application/json" },
      timeoutMs: 15_000,
      retry: { attempts: 3, backoff: "exponential", delaySeconds: 2 },
    },
    callbacks: { correlation: "body.correlationId" },
    capabilities: {},
  };
}

export const capabilitiesOf = (definition: ConnectorDefinition): Capability[] =>
  CAPABILITIES.filter((capability) => definition.capabilities[capability] !== undefined);

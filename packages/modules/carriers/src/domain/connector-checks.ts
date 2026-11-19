import {
  CAPABILITIES,
  type ConnectorDefinition,
  type Flow,
  type FlowStep,
  type HttpCall,
} from "./connector";
import { checkExpression, checkTemplate } from "./mapping";

export interface ConnectorIssue {
  severity: "error" | "warning";
  message: string;
  capability?: string;
  step?: string;
  field?: string;
}

const STEP_ID = /^[a-z][a-z0-9_]{0,40}$/i;

function checkCall(
  call: HttpCall,
  at: Omit<ConnectorIssue, "severity" | "message">,
): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];

  const error = (field: string, message: string) =>
    issues.push({ severity: "error", message, field, ...at });

  if (!call.path.trim()) error("path", "Give the request a path");

  const templates: [string, string | undefined][] = [
    ["path", call.path],
    ["idempotencyKey", call.idempotencyKey],
    ...Object.entries(call.headers ?? {}).map(([name, value]): [string, string] => [
      `headers.${name}`,
      value,
    ]),
    ...Object.entries(call.query ?? {}).map(([name, value]): [string, string] => [
      `query.${name}`,
      value,
    ]),
  ];

  for (const [field, template] of templates) {
    const problem = template === undefined ? null : checkTemplate(template);

    if (problem) error(field, problem);
  }

  const expressions: [string, string | undefined][] = [
    ["body", call.body],
    ["response", call.response],
    ["success", call.success],
    ...(call.errors ?? []).map((mapping, i): [string, string] => [
      `errors.${i}.when`,
      mapping.when,
    ]),
  ];

  for (const [field, expression] of expressions) {
    if (expression === undefined || expression.trim() === "") continue;

    const problem = checkExpression(expression);

    if (problem) error(field, problem);
  }

  if (call.retry && (call.retry.attempts < 1 || call.retry.attempts > 10)) {
    error("retry", "Retry between 1 and 10 attempts");
  }

  if (call.timeoutMs !== undefined && (call.timeoutMs < 100 || call.timeoutMs > 120_000)) {
    error("timeoutMs", "Time out between 0.1 and 120 seconds");
  }

  return issues;
}

function checkStep(step: FlowStep, ids: Set<string>, capability: string): ConnectorIssue[] {
  const at = { capability, step: step.id };
  const issues: ConnectorIssue[] = [];

  const error = (field: string, message: string) =>
    issues.push({ severity: "error", message, field, ...at });

  const expression = (field: string, value: string | undefined, required = true) => {
    if (value === undefined || value.trim() === "") {
      if (required) error(field, "Required");

      return;
    }

    const problem = checkExpression(value);

    if (problem) error(field, problem);
  };

  switch (step.kind) {
    case "request":
      return [...issues, ...checkCall(step, at)];
    case "compensate":
      return [...issues, ...checkCall(step.request, at)];
    case "poll":
      expression("until", step.until);

      if (step.intervalSeconds <= 0) error("intervalSeconds", "Poll at least every few seconds");

      if (step.maxWaitSeconds < step.intervalSeconds) {
        error("maxWaitSeconds", "Wait at least one interval");
      }

      return [...issues, ...checkCall(step.request, at)];
    case "await_callback": {
      const problem = checkTemplate(step.correlation);

      if (!step.correlation.trim()) error("correlation", "Required");

      if (problem) error("correlation", problem);

      expression("when", step.when, false);
      expression("response", step.response, false);

      if (step.timeoutSeconds < 1) error("timeoutSeconds", "Wait at least a second");

      return issues;
    }
    case "branch":
      if (step.cases.length === 0) error("cases", "Add at least one case");

      step.cases.forEach((c, i) => {
        expression(`cases.${i}.when`, c.when);

        if (c.goto !== "end" && !ids.has(c.goto)) error(`cases.${i}.goto`, `No step ${c.goto}`);
      });

      if (step.otherwise && step.otherwise !== "end" && !ids.has(step.otherwise)) {
        error("otherwise", `No step ${step.otherwise}`);
      }

      return issues;
    case "map":
      expression("expression", step.expression);

      return issues;
    case "fail": {
      const problem = checkTemplate(step.message);

      if (problem) error("message", problem);

      return issues;
    }
  }
}

function checkFlow(flow: Flow, capability: string): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  const ids = new Set<string>();

  for (const step of flow.steps) {
    if (!STEP_ID.test(step.id)) {
      issues.push({
        severity: "error",
        message: `Step id "${step.id}" must start with a letter and use letters, numbers or underscores`,
        capability,
        step: step.id,
        field: "id",
      });
    }

    if (ids.has(step.id)) {
      issues.push({
        severity: "error",
        message: `Two steps are called ${step.id}`,
        capability,
        step: step.id,
        field: "id",
      });
    }

    ids.add(step.id);
  }

  if (flow.steps.length === 0) {
    issues.push({ severity: "error", message: "Add at least one step", capability });
  }

  for (const step of flow.steps) issues.push(...checkStep(step, ids, capability));

  const problem = flow.output.trim() ? checkExpression(flow.output) : "Map the flow's output";

  if (problem) issues.push({ severity: "error", message: problem, capability, field: "output" });

  return issues;
}

/** Static checks: ids, references between steps and every expression parses. */
export function checkConnector(definition: ConnectorDefinition): ConnectorIssue[] {
  const issues: ConnectorIssue[] = [];
  const correlation = checkExpression(definition.callbacks.correlation);

  if (correlation) {
    issues.push({ severity: "error", message: correlation, field: "callbacks.correlation" });
  }

  for (const capability of CAPABILITIES) {
    const flow = definition.capabilities[capability];

    if (flow) issues.push(...checkFlow(flow, capability));
  }

  if (!CAPABILITIES.some((c) => definition.capabilities[c])) {
    issues.push({ severity: "error", message: "Configure at least one capability" });
  }

  return issues;
}

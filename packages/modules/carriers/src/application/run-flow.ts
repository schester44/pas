import { isRecord, type WorkflowStep } from "@pas/kernel";
import {
  type AwaitCallbackStep,
  type CompensateStep,
  type ConnectorDefinition,
  type Flow,
  type HttpCall,
  NO_RETRY,
  type PollStep,
} from "../domain/connector";
import { evaluateCondition, evaluateMapping, renderTemplate } from "../domain/mapping";
import { type CarrierOutcome, outcomeFrom } from "../domain/outcome";
import type { ExchangeRecord, FlowIO, HttpResponse } from "../ports/flow-io";

export interface FlowRunInput {
  definition: ConnectorDefinition;
  flow: Flow;
  input: Record<string, unknown>;
  connection: { environment: string; baseUrl: string };
  callbackUrl: string;
  runId: string;
  /**
   * Waits up to this long happen inside the next step instead of as a durable timer: a few
   * seconds of polling don't need a round trip through the queue. A replay repeats the wait.
   */
  inlineWaitSeconds?: number;
}

export interface StepRecord {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  output?: unknown;
  skipped?: boolean;
}

export interface FlowResult {
  status: "succeeded" | "failed";
  outcome: CarrierOutcome;
  error: string | null;
  failedStep: string | null;
  compensated: string[];
  steps: Record<string, StepRecord>;
}

interface CallResult {
  ok: boolean;
  status: number | null;
  body: unknown;
  headers: Record<string, string>;
  output: unknown;
  error: string | null;
  retryable: boolean;
}

class FlowFailure extends Error {
  constructor(
    message: string,
    readonly stepId: string,
  ) {
    super(message);
  }
}

const MAX_EXECUTIONS = 200;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const defaultSuccess = (status: number | null) => status !== null && status >= 200 && status < 300;

const backoffSeconds = (policy: HttpCall["retry"] & object, attempt: number) =>
  policy.backoff === "exponential" ? policy.delaySeconds * 2 ** (attempt - 1) : policy.delaySeconds;

/**
 * Interprets one capability's flow on durable steps (PLAN §12): every HTTP attempt, wait and
 * callback is its own memoized step, so a replay after a restart resumes where it stopped and
 * never repeats a request. Failures run the armed compensations, newest first.
 */
export async function runFlow(
  step: WorkflowStep,
  io: FlowIO,
  run: FlowRunInput,
): Promise<FlowResult> {
  const { definition, flow } = run;
  const steps: Record<string, StepRecord> = {};

  const scope = (extra: Record<string, unknown> = {}) => ({
    input: run.input,
    steps,
    connection: run.connection,
    callback: { url: run.callbackUrl },
    run: { id: run.runId },
    ...extra,
  });

  const pause = async (id: string, seconds: number) => {
    if (io.sleep && seconds <= (run.inlineWaitSeconds ?? 0)) {
      await step.run(id, async () => {
        await io.sleep!(seconds * 1000);

        return true;
      });

      return;
    }

    await step.delay(id, { seconds });
  };

  const call = async (
    spec: HttpCall,
    execId: string,
    stepId: string,
    kind: ExchangeRecord["kind"],
    extra: Record<string, unknown> = {},
  ): Promise<CallResult> => {
    const retry = spec.retry ?? (kind === "compensation" ? NO_RETRY : definition.defaults.retry);

    for (let attempt = 1; ; attempt++) {
      const result = await step.run(`${execId}.a${attempt}`, () =>
        attemptCall(io, definition, run.connection.baseUrl, spec, scope(extra), {
          execId: `${execId}.a${attempt}`,
          stepId,
          kind,
          attempt,
        }),
      );

      if (result.ok || !result.retryable || attempt >= retry.attempts) return result;

      await pause(`${execId}.a${attempt}.backoff`, backoffSeconds(retry, attempt));
    }
  };

  const poll = async (spec: PollStep, execId: string): Promise<StepRecord> => {
    let waited = 0;
    let interval = spec.intervalSeconds;

    for (let n = 0; ; n++) {
      const result = await call(spec.request, `${execId}.p${n}`, spec.id, "poll");

      if (!result.ok) throw new FlowFailure(result.error ?? "The carrier request failed", spec.id);

      const done = guarded(spec.id, () =>
        evaluateCondition(
          spec.until,
          scope({ response: result.body, status: result.status, headers: result.headers }),
        ),
      );

      if (done)
        return {
          status: result.status!,
          body: result.body,
          headers: result.headers,
          output: result.output,
        };

      if (waited + interval > spec.maxWaitSeconds) {
        throw new FlowFailure(`Still waiting on the carrier after ${waited} seconds`, spec.id);
      }

      await pause(`${execId}.p${n}.wait`, interval);
      waited += interval;
      interval = Math.min(interval * spec.backoffFactor, spec.maxIntervalSeconds);
    }
  };

  const awaitCallback = async (spec: AwaitCallbackStep, execId: string): Promise<StepRecord> => {
    if (spec.when && !guarded(spec.id, () => evaluateCondition(spec.when!, scope()))) {
      return { skipped: true };
    }

    const correlation = guarded(spec.id, () => renderTemplate(spec.correlation, scope()));

    if (!correlation) throw new FlowFailure("The callback correlation key is empty", spec.id);

    const event = `carrier.callback:${correlation}`;

    await step.run(`${execId}.register`, async () => {
      await io.awaitCallback(correlation, event);

      return true;
    });

    const data = await step.waitFor<Record<string, unknown>>(event, {
      stepId: `${execId}.wait`,
      timeout: { seconds: spec.timeoutSeconds },
    });

    if (!data) {
      throw new FlowFailure(
        `No callback from the carrier within ${spec.timeoutSeconds} seconds`,
        spec.id,
      );
    }

    const body = data.body ?? data;

    await step.run(`${execId}.received`, async () => {
      await io.record({
        execId: `${execId}.received`,
        stepId: spec.id,
        kind: "callback",
        attempt: 1,
        request: { body },
        response: null,
        ok: true,
        error: null,
        durationMs: 0,
      });

      return true;
    });

    const output = spec.response
      ? guarded(spec.id, () => evaluateMapping(spec.response!, scope({ callback: body })))
      : body;

    return { body, output };
  };

  const armed: CompensateStep[] = [];
  let executions = 0;
  let index = 0;

  try {
    while (index < flow.steps.length) {
      const current = flow.steps[index]!;

      if (++executions > MAX_EXECUTIONS) {
        throw new FlowFailure(
          `The flow ran more than ${MAX_EXECUTIONS} steps; check its branches`,
          current.id,
        );
      }

      const execId = `${executions}.${current.id}`;

      switch (current.kind) {
        case "request": {
          const result = await call(current, execId, current.id, "request");

          if (!result.ok)
            throw new FlowFailure(result.error ?? "The carrier request failed", current.id);

          steps[current.id] = {
            status: result.status!,
            body: result.body,
            headers: result.headers,
            output: result.output,
          };

          index++;
          break;
        }
        case "poll":
          steps[current.id] = await poll(current, execId);
          index++;
          break;
        case "await_callback":
          steps[current.id] = await awaitCallback(current, execId);
          index++;
          break;
        case "map":
          steps[current.id] = {
            output: guarded(current.id, () => evaluateMapping(current.expression, scope())),
          };

          index++;
          break;
        case "compensate":
          armed.push(current);
          index++;
          break;
        case "fail":
          throw new FlowFailure(
            guarded(current.id, () => renderTemplate(current.message, scope())),
            current.id,
          );
        case "branch": {
          const hit = current.cases.find((c) =>
            guarded(current.id, () => evaluateCondition(c.when, scope())),
          );

          const target = hit?.goto ?? current.otherwise;

          if (target === "end") {
            index = flow.steps.length;
          } else if (target) {
            index = flow.steps.findIndex((s) => s.id === target);

            if (index < 0) throw new FlowFailure(`No step ${target}`, current.id);
          } else {
            index++;
          }

          break;
        }
      }
    }

    const mapped = guarded("output", () => evaluateMapping(flow.output, scope()));
    const { outcome, issues } = outcomeFrom(mapped);

    if (issues.length > 0) throw new FlowFailure(`Output mapping: ${issues.join("; ")}`, "output");

    return { status: "succeeded", outcome, error: null, failedStep: null, compensated: [], steps };
  } catch (error) {
    if (!(error instanceof FlowFailure)) throw error;

    const compensated: string[] = [];

    for (const [i, compensation] of armed.toReversed().entries()) {
      const result = await call(
        compensation.request,
        `comp${i}.${compensation.id}`,
        compensation.id,
        "compensation",
      );

      steps[compensation.id] = {
        status: result.status ?? undefined,
        body: result.body,
        output: result.output,
      };

      compensated.push(compensation.id);
    }

    return {
      status: "failed",
      outcome: { status: "failed", documents: [], messages: [{ text: error.message }] },
      error: error.message,
      failedStep: error.stepId,
      compensated,
      steps,
    };
  }
}

function guarded<T>(stepId: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new FlowFailure(message(error), stepId);
  }
}

function joinUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  if (/^https?:\/\//i.test(path)) return withQuery(path, query);

  return withQuery(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`, query);
}

function withQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, value]) => value !== "");

  if (entries.length === 0) return url;

  const parsed = new URL(url);

  for (const [key, value] of entries) parsed.searchParams.set(key, value);

  return parsed.toString();
}

async function attemptCall(
  io: FlowIO,
  definition: ConnectorDefinition,
  baseUrl: string,
  spec: HttpCall,
  context: Record<string, unknown>,
  record: Pick<ExchangeRecord, "execId" | "stepId" | "kind" | "attempt">,
): Promise<CallResult> {
  let request: ExchangeRecord["request"] = { method: spec.method };

  const fail = async (
    error: string,
    response: HttpResponse | null,
    durationMs: number,
    retryable: boolean,
  ) => {
    await io.record({ ...record, request, response, ok: false, error, durationMs });

    return {
      ok: false,
      status: response?.status ?? null,
      body: response?.body ?? null,
      headers: response?.headers ?? {},
      output: null,
      error,
      retryable,
    };
  };

  let outgoing;

  try {
    const render = (values: Record<string, string> = {}) =>
      Object.fromEntries(
        Object.entries(values).map(([k, v]) => [k.toLowerCase(), renderTemplate(v, context)]),
      );

    const headers = { ...render(definition.defaults.headers), ...render(spec.headers) };

    if (spec.idempotencyKey)
      headers["idempotency-key"] = renderTemplate(spec.idempotencyKey, context);

    const body = spec.body?.trim() ? evaluateMapping(spec.body, context) : undefined;

    outgoing = {
      method: spec.method,
      url: joinUrl(baseUrl, renderTemplate(spec.path, context), render(spec.query)),
      headers,
      ...(body !== undefined && { body }),
      timeoutMs: spec.timeoutMs ?? definition.defaults.timeoutMs,
      anonymous: spec.anonymous ?? false,
    };

    request = {
      method: outgoing.method,
      url: outgoing.url,
      headers,
      ...(body !== undefined && { body }),
    };
  } catch (error) {
    return fail(`Couldn't build the request: ${message(error)}`, null, 0, false);
  }

  const sent = await io.send(outgoing);

  if (!sent.ok) return fail(sent.error, null, sent.durationMs, true);

  const { response } = sent;

  const view = {
    ...context,
    status: response.status,
    body: response.body,
    headers: response.headers,
  };

  try {
    const success = spec.success?.trim()
      ? evaluateCondition(spec.success, view)
      : defaultSuccess(response.status);

    if (!success) {
      const mapped = (spec.errors ?? []).find((e) => evaluateCondition(e.when, view));
      const status = response.status;

      const error = mapped
        ? renderTemplate(mapped.message, view)
        : `The carrier answered ${status}${carrierMessage(response.body)}`;

      return fail(
        error,
        response,
        sent.durationMs,
        mapped?.retry ?? (status >= 500 || status === 429),
      );
    }

    const output = spec.response?.trim()
      ? evaluateMapping(spec.response, {
          ...context,
          response: response.body,
          status: response.status,
          headers: response.headers,
        })
      : response.body;

    await io.record({
      ...record,
      request,
      response,
      ok: true,
      error: null,
      durationMs: sent.durationMs,
    });

    return {
      ok: true,
      status: response.status,
      body: response.body,
      headers: response.headers,
      output,
      error: null,
      retryable: false,
    };
  } catch (error) {
    return fail(`Couldn't read the response: ${message(error)}`, response, sent.durationMs, false);
  }
}

function carrierMessage(body: unknown): string {
  if (isRecord(body) && typeof body.message === "string") return `: ${body.message}`;

  if (isRecord(body) && typeof body.error === "string") return `: ${body.error}`;

  return "";
}

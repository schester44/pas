import { ready } from "@pas/expressions";
import type { WorkflowStep } from "@pas/kernel";
import { beforeAll, describe, expect, it } from "vitest";
import { type ConnectorDefinition, emptyConnector, type Flow } from "../domain/connector";
import type { FlowIO, HttpResponse, OutgoingRequest } from "../ports/flow-io";
import { runFlow } from "./run-flow";

beforeAll(() => ready());

function durableSteps(signals: Record<string, Record<string, unknown>> = {}) {
  const memo = new Map<string, unknown>();
  const delays: number[] = [];

  const step: WorkflowStep = {
    run: async (id, fn) => {
      if (!memo.has(id)) memo.set(id, JSON.parse(JSON.stringify(await fn())));

      return memo.get(id) as never;
    },
    delay: async (_id, duration) => {
      delays.push(typeof duration === "string" ? 0 : (duration.seconds ?? 0));
    },
    waitFor: (async (event: string) => signals[event]) as WorkflowStep["waitFor"],
  };

  return { step, delays, memo };
}

function carrier(routes: (request: OutgoingRequest, count: number) => HttpResponse) {
  const sent: OutgoingRequest[] = [];
  const callbacks: string[] = [];

  const io: FlowIO = {
    send: async (request) => {
      sent.push(request);

      return { ok: true, response: routes(request, sent.length), durationMs: 5 };
    },
    record: async () => {},
    awaitCallback: async (correlation) => {
      callbacks.push(correlation);
    },
  };

  return { io, sent, callbacks };
}

const json = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body });

const definition = (flow: Flow): ConnectorDefinition => ({
  ...emptyConnector(),
  defaults: {
    ...emptyConnector().defaults,
    retry: { attempts: 2, backoff: "fixed", delaySeconds: 1 },
  },
  capabilities: { quote: flow },
});

const run = (flow: Flow, io: FlowIO, step: WorkflowStep, input: Record<string, unknown> = {}) =>
  runFlow(step, io, {
    definition: definition(flow),
    flow,
    input,
    connection: { environment: "test", baseUrl: "https://carrier.test/api" },
    callbackUrl: "https://pas.test/cb",
    runId: "run-1",
  });

const quoteFlow: Flow = {
  steps: [
    {
      kind: "request",
      id: "submit",
      method: "POST",
      path: "/applications",
      body: "{ tiv: input.risk.tiv }",
      response: "{ id: response.applicationId }",
    },
    {
      kind: "poll",
      id: "status",
      request: { method: "GET", path: "/applications/{{ steps.submit.output.id }}" },
      until: 'response.status != "pending"',
      intervalSeconds: 2,
      backoffFactor: 2,
      maxIntervalSeconds: 5,
      maxWaitSeconds: 30,
    },
    {
      kind: "branch",
      id: "decide",
      cases: [{ when: 'steps.status.body.status == "referred"', goto: "referred" }],
    },
    {
      kind: "map",
      id: "quoted",
      expression: '{ status: "quoted", premium: steps.status.body.premium }',
    },
    { kind: "branch", id: "done", cases: [{ when: "true", goto: "end" }] },
    { kind: "map", id: "referred", expression: '{ status: "referred", premium: 0 }' },
  ],
  output:
    'steps.quoted.output != null ? { status: steps.quoted.output.status, reference: steps.submit.output.id, premium: { lines: [{ coverage: "DWELL", amount: steps.quoted.output.premium }] } } : { status: "referred", reference: steps.submit.output.id }',
};

describe("runFlow", () => {
  it("polls with backoff until settled, then branches and maps the canonical outcome", async () => {
    const { io, sent } = carrier((request, count) =>
      request.method === "POST"
        ? json(201, { applicationId: "A-1" })
        : json(200, count < 4 ? { status: "pending" } : { status: "quoted", premium: 1234.5 }),
    );

    const { step, delays } = durableSteps();
    const result = await run(quoteFlow, io, step, { risk: { tiv: 400000 } });

    expect(result.status).toBe("succeeded");

    expect(result.outcome).toEqual({
      status: "quoted",
      reference: "A-1",
      premium: { lines: [{ coverage: "DWELL", amount: "1234.5" }], taxesFees: [] },
      documents: [],
      messages: [],
    });

    expect(sent[0]).toMatchObject({
      url: "https://carrier.test/api/applications",
      body: { tiv: 400000 },
    });

    expect(sent[1]!.url).toBe("https://carrier.test/api/applications/A-1");
    expect(delays).toEqual([2, 4]);
  });

  it("takes the other branch on a referral", async () => {
    const { io } = carrier((request) =>
      request.method === "POST"
        ? json(201, { applicationId: "A-2" })
        : json(200, { status: "referred" }),
    );

    const result = await run(quoteFlow, io, durableSteps().step);

    expect(result.outcome).toMatchObject({ status: "referred", reference: "A-2" });
    expect(result.steps.quoted).toBeUndefined();
  });

  it("fails when polling outlasts the maximum wait", async () => {
    const { io } = carrier((request) =>
      request.method === "POST"
        ? json(201, { applicationId: "A-3" })
        : json(200, { status: "pending" }),
    );

    const result = await run(quoteFlow, io, durableSteps().step);

    expect(result.status).toBe("failed");
    expect(result.failedStep).toBe("status");
  });

  it("runs armed compensations newest first when a later step fails, and not the unarmed ones", async () => {
    const flow: Flow = {
      steps: [
        {
          kind: "request",
          id: "hold",
          method: "POST",
          path: "/holds",
          response: "{ id: response.id }",
        },
        {
          kind: "compensate",
          id: "release_hold",
          request: { method: "DELETE", path: "/holds/{{ steps.hold.output.id }}" },
        },
        {
          kind: "request",
          id: "bind",
          method: "POST",
          path: "/binds",
          response: "{ id: response.id }",
        },
        {
          kind: "compensate",
          id: "void_bind",
          request: { method: "POST", path: "/binds/{{ steps.bind.output.id }}/void" },
        },
        {
          kind: "request",
          id: "pay",
          method: "POST",
          path: "/payments",
          errors: [{ when: "status == 402", message: "Payment refused: {{ body.reason }}" }],
        },
        { kind: "compensate", id: "never_armed", request: { method: "POST", path: "/nope" } },
      ],
      output: '{ status: "bound" }',
    };

    const { io, sent } = carrier((request) => {
      if (request.url.endsWith("/holds")) return json(201, { id: "H-1" });

      if (request.url.endsWith("/binds")) return json(201, { id: "B-1" });

      if (request.url.endsWith("/payments")) return json(402, { reason: "card expired" });

      return json(200, {});
    });

    const result = await run(flow, io, durableSteps().step);

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Payment refused: card expired");
    expect(result.compensated).toEqual(["void_bind", "release_hold"]);

    expect(sent.map((r) => `${r.method} ${r.url.replace("https://carrier.test/api", "")}`)).toEqual(
      ["POST /holds", "POST /binds", "POST /payments", "POST /binds/B-1/void", "DELETE /holds/H-1"],
    );
  });

  it("retries a 5xx with backoff, then succeeds", async () => {
    const flow: Flow = {
      steps: [{ kind: "request", id: "submit", method: "POST", path: "/x", response: "response" }],
      output: '{ status: "confirmed", reference: steps.submit.output.id }',
    };

    const { io, sent } = carrier((_r, count) =>
      count === 1 ? json(503, {}) : json(200, { id: "R-9" }),
    );

    const { step, delays } = durableSteps();
    const result = await run(flow, io, step);

    expect(result.outcome.reference).toBe("R-9");
    expect(sent).toHaveLength(2);
    expect(delays).toEqual([1]);
  });

  it("replays from memoized steps without repeating a request", async () => {
    const { io, sent } = carrier((request, count) =>
      request.method === "POST"
        ? json(201, { applicationId: "A-4" })
        : json(200, count < 3 ? { status: "pending" } : { status: "quoted", premium: 900 }),
    );

    const durable = durableSteps();
    const first = await run(quoteFlow, io, durable.step);
    const requests = sent.length;
    const replayed = await run(quoteFlow, io, durable.step);

    expect(replayed).toEqual(first);
    expect(sent).toHaveLength(requests);
  });

  it("resumes on the callback that carries the correlation key", async () => {
    const flow: Flow = {
      steps: [
        { kind: "request", id: "submit", method: "POST", path: "/apps", response: "response" },
        {
          kind: "await_callback",
          id: "decision",
          correlation: "{{ steps.submit.output.id }}",
          when: 'steps.submit.output.status == "pending"',
          timeoutSeconds: 3600,
          response: "{ status: callback.decision }",
        },
      ],
      output: "{ status: steps.decision.output.status, reference: steps.submit.output.id }",
    };

    const { io, callbacks } = carrier(() => json(202, { id: "A-5", status: "pending" }));
    const { step } = durableSteps({ "carrier.callback:A-5": { body: { decision: "quoted" } } });
    const result = await run(flow, io, step);

    expect(callbacks).toEqual(["A-5"]);
    expect(result.outcome).toMatchObject({ status: "quoted", reference: "A-5" });
  });

  it("fails without a callback before the timeout", async () => {
    const flow: Flow = {
      steps: [{ kind: "await_callback", id: "decision", correlation: "X-1", timeoutSeconds: 60 }],
      output: '{ status: "quoted" }',
    };

    const result = await run(flow, carrier(() => json(200, {})).io, durableSteps().step);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No callback");
  });
});

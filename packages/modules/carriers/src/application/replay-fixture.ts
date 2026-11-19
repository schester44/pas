import { canonicalJson, toPlainJson, type WorkflowStep } from "@pas/kernel";
import type { ConnectorDefinition } from "../domain/connector";
import type { Fixture } from "../domain/fixture";
import type { FlowIO, OutgoingRequest } from "../ports/flow-io";
import { runFlow } from "./run-flow";

const pathOf = (url: string) => (URL.canParse(url) ? new URL(url).pathname : url);

/** Memoizes like the durable engine, skips waits and hands out recorded callbacks in order. */
function replaySteps(callbacks: Fixture["callbacks"]): WorkflowStep {
  const memo = new Map<string, unknown>();
  const queue = [...callbacks];

  return {
    run: async (id, fn) => {
      if (!memo.has(id)) memo.set(id, toPlainJson(await fn()));

      return memo.get(id) as never;
    },
    delay: async () => {},
    waitFor: (async () => {
      const next = queue.shift();

      return next ? { body: next.body } : undefined;
    }) as WorkflowStep["waitFor"],
  };
}

/**
 * Replays a recorded run against a definition with a mock HTTP layer (PLAN §12): requests must
 * come in the recorded order and the mapped outcome must equal the recorded one.
 */
export async function replayFixture(
  definition: ConnectorDefinition,
  fixture: Fixture,
): Promise<{ passed: boolean; problems: string[] }> {
  const flow = definition.capabilities[fixture.capability];

  if (!flow)
    return { passed: false, problems: [`The definition has no ${fixture.capability} flow`] };

  const problems: string[] = [];
  const recorded = [...fixture.exchanges];

  const io: FlowIO = {
    send: async (request: OutgoingRequest) => {
      const next = recorded.shift();

      if (!next) {
        problems.push(`Unrecorded request ${request.method} ${pathOf(request.url)}`);

        return { ok: false, error: "No recorded response", durationMs: 0 };
      }

      if (next.method !== request.method || !pathOf(next.url).endsWith(pathOf(request.url))) {
        problems.push(
          `Step ${next.stepId}: expected ${next.method} ${pathOf(next.url)}, the flow sent ${request.method} ${pathOf(request.url)}`,
        );
      }

      return next.response
        ? { ok: true, response: next.response, durationMs: 0 }
        : { ok: false, error: next.error ?? "Recorded failure", durationMs: 0 };
    },
    record: async () => {},
    awaitCallback: async () => {},
  };

  const result = await runFlow(replaySteps(fixture.callbacks), io, {
    definition,
    flow,
    input: fixture.input as unknown as Record<string, unknown>,
    // No base path, so each request's path is matched against the end of the recorded URL.
    connection: { environment: "test", baseUrl: "https://fixture.invalid" },
    callbackUrl: "https://fixture.invalid/callback",
    runId: fixture.id,
  });

  if (recorded.length > 0) {
    problems.push(
      `${recorded.length} recorded request${recorded.length === 1 ? " was" : "s were"} never sent`,
    );
  }

  if (canonicalJson(result.outcome) !== canonicalJson(fixture.expected)) {
    problems.push(
      `Mapped outcome changed: expected ${canonicalJson(fixture.expected)}, got ${canonicalJson(result.outcome)}`,
    );
  }

  return { passed: problems.length === 0, problems };
}

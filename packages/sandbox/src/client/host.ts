import type { Clock, WorkflowStep } from "@pas/kernel";
import { z } from "zod";
import type { FetchArgs, FetchResult } from "./network";

/** Host functions offered to one invocation, keyed by the name the SDK calls. */
export type HostFunctions = Record<string, (args: unknown) => Promise<unknown>>;

const fetchArgsSchema = z.object({
  url: z.string(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
  headers: z.record(z.string(), z.string()),
  body: z.string().nullable(),
});

export const fetchHost = (fetch: (args: FetchArgs) => Promise<FetchResult>): HostFunctions => ({
  fetch: (args) => fetch(fetchArgsSchema.parse(args)),
});

export const clockHost = (clock: Clock): HostFunctions => ({
  "clock.now": async () => clock.now().toString(),
});

const stepArgs = z.object({ id: z.string().min(1) });

/**
 * Bridges `ctx.step.run(id, fn)` onto a workflow step. `fn` runs in the sandbox, so the host
 * holds the step open between `step.begin` and `step.complete`; a memoized step answers
 * `step.begin` directly and the sandbox skips `fn`.
 */
export function stepHost(step: WorkflowStep): HostFunctions {
  const open = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const running = new Map<string, Promise<unknown>>();

  const settle = async (id: string, outcome: { value: unknown } | { error: Error }) => {
    const pending = open.get(id);

    if (!pending) throw new Error(`Step ${id} isn't running`);

    open.delete(id);

    if ("error" in outcome) pending.reject(outcome.error);
    else pending.resolve(outcome.value);

    try {
      await running.get(id);
    } finally {
      running.delete(id);
    }

    return null;
  };

  return {
    "step.begin": (args) => {
      const { id } = stepArgs.parse(args);

      if (running.has(id)) throw new Error(`Step ${id} is already running`);

      return new Promise((reply, refuse) => {
        let ran = false;

        const done = step.run(id, () => {
          ran = true;
          reply({ memoized: false });

          return new Promise((resolve, reject) => open.set(id, { resolve, reject }));
        });

        running.set(id, done);

        done.then(
          (value) => {
            if (!ran) {
              running.delete(id);
              reply({ memoized: true, value });
            }
          },
          (error: unknown) => {
            if (!ran) {
              running.delete(id);
              refuse(error);
            }
          },
        );
      });
    },
    "step.complete": (args) => {
      const { id, value } = stepArgs.extend({ value: z.unknown() }).parse(args);

      return settle(id, { value });
    },
    "step.fail": async (args) => {
      const { id, message } = stepArgs.extend({ message: z.string() }).parse(args);

      await settle(id, { error: new Error(message) }).catch(() => undefined);

      return null;
    },
  };
}

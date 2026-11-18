import type { WaitForOptions, WorkflowStep } from "@pas/kernel";
import { durationToMilliseconds } from "./duration";
import type { Queryable, RunKey, WorkflowStore } from "./store";

/** Thrown to unwind the handler when it reaches a wait that isn't satisfied yet. */
export class Suspended extends Error {}

/** Thrown when the run was cancelled while executing. */
export class Halted extends Error {}

export type ScheduleTimer = (db: Queryable, wakeAt: Date) => Promise<void>;

export function replayStep(
  store: WorkflowStore,
  key: RunKey,
  memo: Map<string, unknown>,
  scheduleTimer: ScheduleTimer,
): WorkflowStep {
  const enter = async (stepId: string) => {
    if (!(await store.enterStep(key, stepId))) throw new Halted();
  };

  const wait = async (
    stepId: string,
    event: string | null,
    timeoutMs: number | null,
    parse: (data: Record<string, unknown>) => unknown,
  ): Promise<unknown> => {
    await enter(stepId);

    const outcome = await store.transaction(async (client) => {
      const data = event ? await store.consumeEvent(client, key, event, stepId) : undefined;

      if (data) return { value: await store.memoize(client, key, stepId, parse(data)) };

      const pending = await store.wait(client, key, stepId, event, timeoutMs);

      if (pending.due) return { value: await store.memoize(client, key, stepId, undefined) };

      if (pending.created && pending.wakeAt) await scheduleTimer(client, pending.wakeAt);

      return undefined;
    });

    if (!outcome) throw new Suspended();

    memo.set(stepId, outcome.value);

    return outcome.value;
  };

  return {
    run: async (id, fn) => {
      if (memo.has(id)) return memo.get(id) as Awaited<ReturnType<typeof fn>>;

      await enter(id);
      const value = await store.memoize(store.pool, key, id, await fn());
      memo.set(id, value);

      return value as Awaited<ReturnType<typeof fn>>;
    },
    delay: async (id, duration) => {
      if (memo.has(id)) return;

      await wait(id, null, durationToMilliseconds(duration), (data) => data);
    },
    waitFor: (async <T>(event: string, options: WaitForOptions<T> = {}) => {
      const id = options.stepId ?? event;

      if (memo.has(id)) return memo.get(id);

      const timeoutMs =
        options.timeout === undefined ? null : durationToMilliseconds(options.timeout);

      return wait(id, event, timeoutMs, (data) =>
        options.schema ? options.schema.parse(data) : data,
      );
    }) as WorkflowStep["waitFor"],
  };
}

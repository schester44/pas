import type { Invocation, InvocationResult } from "@pas/sandbox/protocol";
import type { Logger } from "@pas/observability";
import { Worker } from "node:worker_threads";
import type { FromThread, ToThread } from "./messages";

export interface RunHandlers {
  onHostCall(callId: number, name: string, args: unknown): void;
}

export interface RunningInvocation {
  done: Promise<InvocationResult>;
  hostResult(callId: number, ok: boolean, value?: unknown, error?: string): void;
  cancel(): void;
}

interface Job {
  handlers: RunHandlers;
  resolve(result: InvocationResult): void;
}

interface Thread {
  worker: Worker;
  jobs: Map<string, Job>;
}

const threadEntry = new URL(
  import.meta.url.endsWith(".ts") ? "./thread.ts" : "./thread.js",
  import.meta.url,
);

const crashed = (message: string): InvocationResult => ({
  ok: false,
  error: { code: "sandbox_crashed", message },
  logs: [],
  stats: { cpuMs: 0, wallMs: 0, hostCalls: 0 },
});

/** How long past its own wall limit an invocation may run before its thread is killed. */
const WATCHDOG_GRACE_MS = 2_000;

const timedOut = (wallMs: number): InvocationResult => ({
  ok: false,
  error: { code: "timeout", message: `The extension ran longer than ${wallMs}ms` },
  logs: [],
  stats: { cpuMs: 0, wallMs, hostCalls: 0 },
});

/**
 * Worker threads, each running many invocations (each in its own WASM instance). A thread that
 * dies, say from hitting its heap limit, fails only its own invocations and is replaced.
 */
export class ThreadPool {
  private readonly threads: Thread[] = [];
  private closing = false;

  constructor(private readonly options: { size: number; heapMb: number; logger: Logger }) {
    for (let i = 0; i < options.size; i++) this.threads.push(this.spawn());
  }

  private spawn(): Thread {
    const worker = new Worker(threadEntry, {
      resourceLimits: { maxOldGenerationSizeMb: this.options.heapMb, maxYoungGenerationSizeMb: 64 },
    });

    const thread: Thread = { worker, jobs: new Map() };

    worker.on("message", (message: FromThread) => {
      const job = thread.jobs.get(message.invocationId);

      if (!job) return;

      if (message.type === "host_call") {
        job.handlers.onHostCall(message.callId, message.name, message.args);
      } else {
        thread.jobs.delete(message.invocationId);
        job.resolve(message.result);
      }
    });

    worker.on("error", (error) =>
      this.options.logger.error({ err: error }, "sandbox thread failed"),
    );

    worker.on("exit", (code) => {
      for (const job of thread.jobs.values())
        job.resolve(crashed(`The sandbox thread exited (${code})`));

      thread.jobs.clear();

      const index = this.threads.indexOf(thread);

      if (index !== -1 && !this.closing) this.threads[index] = this.spawn();
    });

    return thread;
  }

  run(invocation: Invocation, handlers: RunHandlers): RunningInvocation {
    const thread = this.threads.reduce((least, t) => (t.jobs.size < least.jobs.size ? t : least));
    // worker_threads, not window.postMessage: there is no origin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    const send = (message: ToThread) => thread.worker.postMessage(message);
    const { invocationId } = invocation;

    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const done = new Promise<InvocationResult>((resolve) => {
      thread.jobs.set(invocationId, {
        handlers,
        resolve: (result) => {
          clearTimeout(watchdog);
          resolve(result);
        },
      });
    });

    // QuickJS's interrupt handler doesn't fire inside some native calls (a long String#indexOf),
    // and then nothing on that thread runs, timers included; only terminating it frees it.
    watchdog = setTimeout(() => {
      const job = thread.jobs.get(invocationId);

      if (!job) return;

      thread.jobs.delete(invocationId);
      job.resolve(timedOut(invocation.limits.wallMs));

      this.options.logger.warn(
        { tenantId: invocation.tenantId, invocationId },
        "sandbox thread stuck past its wall limit; restarting it",
      );

      void thread.worker.terminate();
    }, invocation.limits.wallMs + WATCHDOG_GRACE_MS);

    send({ type: "invoke", invocation });

    return {
      done,
      hostResult: (callId, ok, value, error) =>
        send({ type: "host_result", invocationId, callId, ok, value, error }),
      cancel: () => send({ type: "cancel", invocationId }),
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.threads.map((t) => t.worker.terminate()));
  }
}

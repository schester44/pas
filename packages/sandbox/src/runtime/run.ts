import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
} from "quickjs-emscripten-core";
import type { Invocation, InvocationResult, LogEntry, SandboxErrorCode } from "../protocol";
import { prelude } from "./prelude";

export type HostCall = (name: string, args: unknown) => Promise<unknown>;

const MAX_LOGS = 200;
const MAX_LOG_CHARS = 4_000;
const logLevels = new Set<LogEntry["level"]>(["debug", "info", "warn", "error"]);

class Failure extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const describe = (ctx: QuickJSContext, handle: QuickJSHandle): string => {
  const dumped: unknown = ctx.dump(handle);

  if (dumped && typeof dumped === "object" && "message" in dumped) {
    const { name, message } = dumped as { name?: unknown; message?: unknown };

    return name ? `${String(name)}: ${String(message)}` : String(message);
  }

  return typeof dumped === "string" ? dumped : JSON.stringify(dumped);
};

/**
 * Runs one invocation in its own WASM instance, so nothing (heap, globals, a QuickJS bug)
 * survives into the next. The instance is abandoned rather than disposed: QuickJS asserts on
 * leaked handles when a run is cut short, and the garbage collector frees it either way.
 */
export async function runInvocation(
  invocation: Invocation,
  options: { host: HostCall; signal?: AbortSignal },
): Promise<InvocationResult> {
  const { limits } = invocation;
  const startedAt = performance.now();
  const logs: LogEntry[] = [];
  const offered = new Set(invocation.hostFunctions);
  let cpuMs = 0;
  let sliceStart: number | null = null;
  let hostCalls = 0;
  let inFlight = 0;
  let finished = false;
  let interruptedBy: SandboxErrorCode | null = null;
  let stopReason: Failure | null = null;
  let notify: (() => void) | null = null;
  let signalled = false;

  const signalActivity = () => {
    if (notify) {
      notify();
      notify = null;
    } else {
      signalled = true;
    }
  };

  const nextActivity = () =>
    new Promise<void>((resolve) => {
      if (signalled) {
        signalled = false;
        resolve();
      } else {
        notify = resolve;
      }
    });

  const stop = (failure: Failure) => {
    stopReason ??= failure;
    signalActivity();
  };

  const wallTimer = setTimeout(
    () => stop(new Failure("timeout", `The extension ran longer than ${limits.wallMs}ms`)),
    limits.wallMs,
  );

  const onAbort = () => stop(new Failure("timeout", "The invocation was cancelled"));

  options.signal?.addEventListener("abort", onAbort, { once: true });

  const stats = () => ({
    cpuMs: Math.round(cpuMs * 100) / 100,
    wallMs: Math.round(performance.now() - startedAt),
    hostCalls,
  });

  const fail = (failure: Failure): InvocationResult => ({
    ok: false,
    error: { code: failure.code, message: failure.message },
    logs,
    stats: stats(),
  });

  const module = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = module.newRuntime();

  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);

  runtime.setInterruptHandler(() => {
    if (stopReason) {
      interruptedBy = stopReason.code;

      return true;
    }

    if (sliceStart !== null && cpuMs + performance.now() - sliceStart > limits.cpuMs) {
      interruptedBy = "cpu_limit";

      return true;
    }

    return false;
  });

  const ctx = runtime.newContext();

  const slice = <T>(fn: () => T): T => {
    sliceStart = performance.now();

    try {
      return fn();
    } finally {
      cpuMs += performance.now() - sliceStart;
      sliceStart = null;
    }
  };

  const failureFrom = (code: SandboxErrorCode, errorHandle: QuickJSHandle): Failure => {
    if (interruptedBy === "cpu_limit") {
      return new Failure("cpu_limit", `The extension used more than ${limits.cpuMs}ms of CPU`);
    }

    if (interruptedBy && stopReason) return stopReason;

    const message = describe(ctx, errorHandle);

    if (/out of memory/i.test(message)) {
      return new Failure(
        "memory_limit",
        `The extension used more than ${limits.memoryBytes} bytes`,
      );
    }

    return new Failure(code, message);
  };

  const hostFn = ctx.newFunction("__pas_host", (nameHandle, argsHandle) => {
    const name = ctx.getString(nameHandle);
    const args: unknown = JSON.parse(ctx.getString(argsHandle));

    if (!offered.has(name)) {
      return { error: ctx.newError(`Host function ${name} isn't available here`) };
    }

    hostCalls += 1;

    if (hostCalls > limits.maxHostCalls) {
      stop(new Failure("host_call_limit", `More than ${limits.maxHostCalls} host calls`));

      return { error: ctx.newError("Host call limit reached") };
    }

    const deferred = ctx.newPromise();

    inFlight += 1;

    options.host(name, args).then(
      (value) => {
        inFlight -= 1;

        if (finished) return;

        const json = ctx.newString(JSON.stringify(value ?? null));

        deferred.resolve(json);
        json.dispose();
        signalActivity();
      },
      (error: unknown) => {
        inFlight -= 1;

        if (finished) return;

        const reason = ctx.newError(error instanceof Error ? error.message : String(error));

        deferred.reject(reason);
        reason.dispose();
        signalActivity();
      },
    );

    return deferred.handle;
  });

  const logFn = ctx.newFunction("__pas_log", (levelHandle, messageHandle) => {
    if (logs.length >= MAX_LOGS) return;

    const level = ctx.getString(levelHandle) as LogEntry["level"];

    logs.push({
      level: logLevels.has(level) ? level : "info",
      message: ctx.getString(messageHandle).slice(0, MAX_LOG_CHARS),
    });
  });

  ctx.setProp(ctx.global, "__pas_host", hostFn);
  ctx.setProp(ctx.global, "__pas_log", logFn);
  ctx.setProp(ctx.global, "__pas_offered", ctx.newString(JSON.stringify([...offered])));

  try {
    const preluded = slice(() => ctx.evalCode(prelude, "prelude.js"));

    if (preluded.error) throw failureFrom("extension_error", preluded.error);

    const invoke = ctx.getProp(ctx.global, "__pas_invoke");

    const evaluated = slice(() =>
      ctx.evalCode(invocation.code, "extension.js", { type: "module" }),
    );

    if (evaluated.error) throw failureFrom("extension_error", evaluated.error);

    if (
      ctx.getPromiseState(evaluated.value).type !== "fulfilled" ||
      ctx.typeof(evaluated.value) !== "object"
    ) {
      throw new Failure("bad_entry", "Extensions can't use top-level await");
    }

    const entry = ctx.getProp(evaluated.value, invocation.entry);

    if (ctx.typeof(entry) !== "function") {
      throw new Failure(
        "bad_entry",
        `The extension doesn't export a function named ${invocation.entry}`,
      );
    }

    const called = slice(() =>
      ctx.callFunction(
        invoke,
        ctx.undefined,
        entry,
        ctx.newString(JSON.stringify(invocation.input ?? null)),
      ),
    );

    if (called.error) throw failureFrom("extension_error", called.error);

    const promise = called.value;

    for (;;) {
      if (stopReason) throw stopReason;

      const jobs = slice(() => runtime.executePendingJobs());

      if (jobs.error) throw failureFrom("extension_error", jobs.error);

      const state = ctx.getPromiseState(promise);

      if (state.type === "fulfilled") {
        const json = ctx.getString(state.value);

        if (new TextEncoder().encode(json).byteLength > limits.maxOutputBytes) {
          throw new Failure(
            "output_too_large",
            `The output is larger than ${limits.maxOutputBytes} bytes`,
          );
        }

        return { ok: true, output: JSON.parse(json), logs, stats: stats() };
      }

      if (state.type === "rejected") throw failureFrom("extension_error", state.error);

      if (inFlight === 0) {
        throw new Failure("never_settled", "The extension's promise never settles");
      }

      await nextActivity();
    }
  } catch (error) {
    if (error instanceof Failure) return fail(error);

    return fail(
      new Failure("extension_error", error instanceof Error ? error.message : String(error)),
    );
  } finally {
    finished = true;
    clearTimeout(wallTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

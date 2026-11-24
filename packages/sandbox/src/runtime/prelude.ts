/**
 * Evaluated inside each fresh QuickJS context before the extension. Builds the `ctx` SDK from the
 * host functions the caller offered, captures console output and removes ambient time and
 * randomness so a replayed invocation computes the same thing.
 */
export const prelude = String.raw`
(() => {
  const host = globalThis.__pas_host;
  const emit = globalThis.__pas_log;
  const offered = new Set(JSON.parse(globalThis.__pas_offered));

  delete globalThis.__pas_host;
  delete globalThis.__pas_log;
  delete globalThis.__pas_offered;

  const call = async (name, args) => JSON.parse(await host(name, JSON.stringify(args ?? null)));
  const unavailable = (what) => new Error(what + " isn't available in extensions; use ctx.clock.now()");

  Math.random = () => {
    throw new Error("Math.random isn't available in extensions");
  };

  const RealDate = Date;

  class SandboxDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) throw unavailable("new Date() without arguments");
      super(...args);
    }

    static now() {
      throw unavailable("Date.now()");
    }
  }

  globalThis.Date = SandboxDate;

  const format = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.name + ": " + value.message;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const log = (level) => (...args) => emit(level, args.map(format).join(" "));

  globalThis.console = {
    log: log("info"),
    info: log("info"),
    debug: log("debug"),
    warn: log("warn"),
    error: log("error"),
  };

  const ctx = {};

  if (offered.has("fetch")) {
    ctx.fetch = async (url, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      let body = init.body;

      if (body !== undefined && body !== null && typeof body !== "string") {
        body = JSON.stringify(body);
        if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
          headers["content-type"] = "application/json";
        }
      }

      const response = await call("fetch", {
        url: String(url),
        method: (init.method ?? "GET").toUpperCase(),
        headers,
        body: body ?? null,
      });

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        url: response.url,
        headers: response.headers,
        text: async () => response.body,
        json: async () => JSON.parse(response.body),
      };
    };
  }

  if (offered.has("clock.now")) {
    ctx.clock = { now: () => call("clock.now") };
  }

  if (offered.has("step.begin")) {
    ctx.step = {
      run: async (id, fn) => {
        const begun = await call("step.begin", { id });

        if (begun.memoized) return begun.value;

        let value;

        try {
          value = await fn();
        } catch (error) {
          await call("step.fail", { id, message: format(error) });
          throw error;
        }

        await call("step.complete", { id, value: value === undefined ? null : value });

        return value;
      },
    };
  }

  for (const name of offered) {
    if (!name.startsWith("pas.")) continue;

    const parts = name.split(".").slice(1);
    let node = (ctx.pas ??= {});

    for (const part of parts.slice(0, -1)) node = node[part] ??= {};

    node[parts[parts.length - 1]] = (args) => call(name, args);
  }

  Object.freeze(ctx);

  globalThis.__pas_invoke = async (fn, inputJson) => {
    const output = await fn(JSON.parse(inputJson), ctx);

    return JSON.stringify(output === undefined ? null : output);
  };
})();
`;

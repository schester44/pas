import { describe, expect, it } from "vitest";
import { defaultSandboxLimits, type Invocation } from "../protocol";
import { runInvocation } from "./run";

const invocation = (code: string, overrides: Partial<Invocation> = {}): Invocation => ({
  invocationId: "inv-1",
  tenantId: "tenant-1",
  code,
  entry: "default",
  input: { n: 2 },
  hostFunctions: [],
  limits: defaultSandboxLimits,
  ...overrides,
});

const noHost = async () => {
  throw new Error("no host");
};

describe("runInvocation", () => {
  it("runs the entry with the input and returns its output", async () => {
    const result = await runInvocation(
      invocation(
        "export default async (input) => { console.log('hi', input); return input.n * 21; }",
      ),
      { host: noHost },
    );

    expect(result).toMatchObject({
      ok: true,
      output: 42,
      logs: [{ level: "info", message: 'hi {"n":2}' }],
    });
  });

  it("proxies concurrent host calls and only exposes offered functions", async () => {
    const calls: string[] = [];

    const result = await runInvocation(
      invocation(
        `export default async (_input, ctx) => {
          const [a, b] = await Promise.all([ctx.fetch("https://a.test/x"), ctx.fetch("https://b.test/y")]);
          return { a: (await a.json()).v, b: (await b.json()).v, now: await ctx.clock.now(), step: typeof ctx.step };
        }`,
        { hostFunctions: ["fetch", "clock.now"] },
      ),
      {
        host: async (name, args) => {
          calls.push(name);

          if (name === "clock.now") return "2027-03-01T00:00:00Z";

          const { url } = args as { url: string };

          await new Promise((resolve) => setTimeout(resolve, 20));

          return { status: 200, url, headers: {}, body: JSON.stringify({ v: new URL(url).host }) };
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      output: { a: "a.test", b: "b.test", now: "2027-03-01T00:00:00Z", step: "undefined" },
      stats: { hostCalls: 3 },
    });

    expect(calls).toEqual(["fetch", "fetch", "clock.now"]);
  });

  it("removes ambient time and randomness", async () => {
    for (const expr of ["Date.now()", "new Date()", "Math.random()"]) {
      const result = await runInvocation(invocation(`export default () => ${expr};`), {
        host: noHost,
      });

      expect(result).toMatchObject({ ok: false, error: { code: "extension_error" } });
    }

    const parsed = await runInvocation(
      invocation("export default () => new Date('2027-01-02T00:00:00Z').getUTCDate();"),
      { host: noHost },
    );

    expect(parsed).toMatchObject({ ok: true, output: 2 });
  });

  it("enforces CPU, memory, wall-clock and host-call limits", async () => {
    const limits = { ...defaultSandboxLimits, cpuMs: 50, wallMs: 300, maxHostCalls: 2 };

    const run = (code: string, hostFunctions: string[] = []) =>
      runInvocation(invocation(code, { limits, hostFunctions }), {
        host: async () => new Promise((resolve) => setTimeout(() => resolve(null), 1_000)),
      });

    expect(await run("export default () => { for (;;) {} };")).toMatchObject({
      error: { code: "cpu_limit" },
    });

    expect(
      await run("export default () => { const a = []; for (;;) a.push('x'.repeat(1e5)); };"),
    ).toMatchObject({
      error: { code: expect.stringMatching(/memory_limit|cpu_limit/) },
    });

    expect(await run("export default (_i, ctx) => ctx.clock.now();", ["clock.now"])).toMatchObject({
      error: { code: "timeout" },
    });

    expect(
      await run("export default (_i, ctx) => Promise.all([1, 2, 3].map(() => ctx.clock.now()));", [
        "clock.now",
      ]),
    ).toMatchObject({ error: { code: "host_call_limit" } });

    expect(await run("export default () => new Promise(() => {});")).toMatchObject({
      error: { code: "never_settled" },
    });
  });

  it("isolates invocations from each other", async () => {
    await runInvocation(invocation("globalThis.leak = 1; export default () => 1;"), {
      host: noHost,
    });

    const result = await runInvocation(invocation("export default () => typeof globalThis.leak;"), {
      host: noHost,
    });

    expect(result).toMatchObject({ ok: true, output: "undefined" });
  });
});

import { POINT_SPECS } from "@pas/extension-points";
import { invalid, type TenantContext, type WorkflowStep } from "@pas/kernel";
import type { Extension } from "../domain/extension";
import { ENTRY_FILE, exportNameFor, type ExtensionManifest } from "../domain/manifest";
import { type ExtensionTest, judge, reportOf, type TestReport } from "../domain/test-case";
import type { HostServices } from "../ports/services";
import type { ExtensionDeps } from "./deps";
import { execute } from "./execute";

/** Compiles a draft and checks it exports a function for every declared point. */
export async function compileDraft(
  deps: Pick<ExtensionDeps, "compiler">,
  files: Record<string, string>,
  manifest: ExtensionManifest,
): Promise<string> {
  const compiled = await deps.compiler.compile(files, ENTRY_FILE);

  if (!compiled.ok) {
    throw invalid("The extension doesn't compile", {
      reason: "compile_failed",
      issues: compiled.issues,
    });
  }

  const missing = manifest.points.filter(
    (point) => !compiled.exports.includes(exportNameFor(point)),
  );

  if (missing.length > 0) {
    throw invalid(
      `${ENTRY_FILE} must export ${missing.map((p) => `${exportNameFor(p)}()`).join(", ")}`,
      {
        reason: "missing_exports",
        issues: missing.map((p) => `Export ${exportNameFor(p)} for ${p}`),
      },
    );
  }

  return compiled.code;
}

/** Tests never wait: steps run inline, delays resolve at once and waits time out. */
const testStep: WorkflowStep = {
  run: (_id, fn) => fn(),
  delay: async () => undefined,
  waitFor: (async () => undefined) as WorkflowStep["waitFor"],
};

/** Automation tests see the PAS SDK, but nothing it asks for happens. */
const simulatedServices = (granted: readonly string[], calls: string[]): HostServices =>
  Object.fromEntries(
    granted.map((name) => [
      name,
      async () => {
        calls.push(name);

        return { simulated: true };
      },
    ]),
  );

export async function runTests(
  deps: Pick<ExtensionDeps, "uow" | "extensions" | "secrets" | "runner" | "runs" | "clocks">,
  ctx: TenantContext,
  input: {
    extension: Extension;
    code: string;
    manifest: ExtensionManifest;
    tests: readonly ExtensionTest[];
    record: boolean;
  },
): Promise<{ report: TestReport; tests: ExtensionTest[] }> {
  const ranAt = deps.clocks.forTenant(ctx.tenantId).now().toString();
  const tests: ExtensionTest[] = [];

  const results = await Promise.all(
    input.tests.map(async (test) => {
      if (!input.manifest.points.includes(test.point)) {
        tests.push(test);

        return {
          testId: test.id,
          name: test.name,
          point: test.point,
          passed: false,
          problems: [`${test.point} isn't one of this extension's points`],
          output: null,
          logs: [],
          durationMs: 0,
        };
      }

      const calls: string[] = [];

      const outcome = await execute(deps, ctx, {
        extensionId: input.extension.id,
        extensionVersionId: null,
        version: null,
        code: input.code,
        manifest: input.manifest,
        point: test.point,
        input: test.input,
        wallMs: POINT_SPECS[test.point].maxTimeoutMs,
        network: input.record ? "record" : "fixtures",
        fixtures: test.network,
        trigger: "test",
        subject: { type: "extension_test", id: test.id },
        step: testStep,
        ...(test.point === "automation" && {
          services: simulatedServices(input.manifest.services, calls),
        }),
      });

      tests.push(input.record ? { ...test, network: outcome.run.network } : test);

      return {
        testId: test.id,
        name: test.name,
        point: test.point,
        passed: false,
        problems: judge(test, {
          ok: outcome.ok,
          output: outcome.ok ? outcome.output : null,
          error: outcome.ok ? null : outcome.error.message,
        }),
        output: outcome.run.output,
        logs: [
          ...outcome.run.logs,
          ...calls.map((name) => ({ level: "info", message: `Simulated ${name}` })),
        ],
        durationMs: outcome.run.stats.wallMs,
      };
    }),
  );

  const judged = results.map((r) => ({ ...r, passed: r.problems.length === 0 }));
  const order = new Map(input.tests.map((t, i) => [t.id, i]));

  return {
    report: reportOf(input.manifest.points, judged, ranAt),
    tests: tests.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
  };
}

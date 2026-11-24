import { type ExtensionPoint, POINT_SPECS } from "@pas/extension-points";
import type { TenantContext } from "@pas/kernel";
import type { TestReport } from "../domain/test-case";
import type { ExtensionDeps } from "./deps";
import { type ExtensionRunDetailDto, toRunDetailDto } from "./dto";
import { execute } from "./execute";
import { loadExtension } from "./load";
import { compileDraft, runTests } from "./run-tests";

/**
 * Runs the draft's tests. `record` calls the real hosts and saves what came back as each test's
 * fixtures, so later runs (and sandbox tenants) answer from them.
 */
export function makeTestExtension(
  deps: Pick<
    ExtensionDeps,
    "uow" | "extensions" | "secrets" | "runner" | "runs" | "clocks" | "compiler"
  >,
) {
  return async function testExtension(
    ctx: TenantContext,
    input: { id: string; record?: boolean; testIds?: string[] },
  ): Promise<TestReport> {
    const extension = await deps.uow.run(ctx, (tx) =>
      loadExtension(deps.extensions, tx, ctx, input.id),
    );

    const { files, manifest, tests } = extension.draft;
    const code = await compileDraft(deps, files, manifest);
    const selected = input.testIds ? tests.filter((t) => input.testIds!.includes(t.id)) : tests;

    const ran = await runTests(deps, ctx, {
      extension,
      code,
      manifest,
      tests: selected,
      record: input.record ?? false,
    });

    if (input.record) {
      await deps.uow.run(ctx, async (tx) => {
        const fresh = await loadExtension(deps.extensions, tx, ctx, input.id);
        const recorded = new Map(ran.tests.map((t) => [t.id, t]));

        fresh.editDraft(
          { tests: fresh.draft.tests.map((t) => recorded.get(t.id) ?? t) },
          deps.clocks.forTenant(ctx.tenantId),
        );

        await deps.extensions.save(tx, fresh);
      });
    }

    return ran.report;
  };
}

export type TestExtension = ReturnType<typeof makeTestExtension>;

/** "Try it" in the editor: runs the draft once on an input, against fixtures or the real hosts. */
export function makeTryExtension(
  deps: Pick<
    ExtensionDeps,
    "uow" | "extensions" | "secrets" | "runner" | "runs" | "clocks" | "compiler"
  >,
) {
  return async function tryExtension(
    ctx: TenantContext,
    input: { id: string; point: ExtensionPoint; input: unknown; live: boolean },
  ): Promise<ExtensionRunDetailDto> {
    const extension = await deps.uow.run(ctx, (tx) =>
      loadExtension(deps.extensions, tx, ctx, input.id),
    );

    const { files, manifest, tests } = extension.draft;
    const code = await compileDraft(deps, files, manifest);

    const outcome = await execute(deps, ctx, {
      extensionId: extension.id,
      extensionVersionId: null,
      version: null,
      code,
      manifest,
      point: input.point,
      input: input.input,
      wallMs: POINT_SPECS[input.point].maxTimeoutMs,
      network: input.live ? "live" : "fixtures",
      fixtures: tests.flatMap((t) => t.network),
      trigger: "test",
      subject: { type: "extension_try", id: extension.id },
    });

    return toRunDetailDto(outcome.run);
  };
}

export type TryExtension = ReturnType<typeof makeTryExtension>;

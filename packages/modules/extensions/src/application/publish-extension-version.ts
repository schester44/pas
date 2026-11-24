import {
  canonicalJson,
  DomainError,
  invalid,
  newId,
  sha256,
  type TenantContext,
} from "@pas/kernel";
import { checkManifest } from "../domain/manifest";
import type { TestReport } from "../domain/test-case";
import type { ExtensionVersion } from "../domain/version";
import type { ExtensionDeps } from "./deps";
import { type ExtensionVersionDto, toVersionDto } from "./dto";
import { loadExtension } from "./load";
import { compileDraft, runTests } from "./run-tests";

/** Compile, check, run every test against its fixtures, then freeze the draft as the next version. */
export function makePublishExtensionVersion(deps: ExtensionDeps) {
  return async function publishExtensionVersion(
    ctx: TenantContext,
    input: { id: string; note?: string | null },
  ): Promise<{ version: ExtensionVersionDto; report: TestReport }> {
    const { extension, secretNames } = await deps.uow.run(ctx, async (tx) => {
      const loaded = await loadExtension(deps.extensions, tx, ctx, input.id);
      const secrets = await deps.extensions.secrets(tx, ctx, loaded.id);

      return { extension: loaded, secretNames: new Set(secrets.map((s) => s.name)) };
    });

    const { files, manifest, tests } = extension.draft;
    const issues = checkManifest(manifest, secretNames);

    if (issues.length > 0) {
      throw invalid(
        `Fix ${issues.length === 1 ? "1 issue" : `${issues.length} issues`} before publishing`,
        {
          reason: "manifest_invalid",
          issues,
        },
      );
    }

    const code = await compileDraft(deps, files, manifest);

    const { report } = await runTests(deps, ctx, {
      extension,
      code,
      manifest,
      tests,
      record: false,
    });

    if (!report.passed) {
      throw new DomainError(
        "precondition_failed",
        "Every point needs a test and every test must pass",
        {
          reason: "tests_failed",
          report,
        },
      );
    }

    const contentHash = await sha256(canonicalJson({ code, manifest }));

    return deps.uow.run(ctx, async (tx) => {
      const fresh = await loadExtension(deps.extensions, tx, ctx, input.id);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      if (canonicalJson(fresh.draft) !== canonicalJson(extension.draft)) {
        throw new DomainError("conflict", "The draft changed while publishing; publish again", {
          reason: "draft_changed",
        });
      }

      const version: ExtensionVersion = {
        id: newId<"ExtensionVersion">(),
        tenantId: ctx.tenantId,
        extensionId: fresh.id,
        version: fresh.latestVersion + 1,
        code,
        source: structuredClone(files),
        manifest: structuredClone(manifest),
        tests: structuredClone(tests),
        contentHash,
        testReport: report,
        note: input.note?.trim() || null,
        publishedAt: clock.now(),
      };

      fresh.published({ versionId: version.id, version: version.version }, clock);
      await deps.extensions.insertVersion(tx, version);
      await deps.extensions.save(tx, fresh);
      await deps.outbox.add(tx, fresh.pullEvents());

      return { version: toVersionDto(version), report };
    });
  };
}

export type PublishExtensionVersion = ReturnType<typeof makePublishExtensionVersion>;

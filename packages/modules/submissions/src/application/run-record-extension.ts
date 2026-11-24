import {
  type BindingInvoker,
  checkActionInput,
  type DisplayBlock,
  type ExtensionBinding,
  noExtensions,
} from "@pas/extension-points";
import { schemaIndex, setAt } from "@pas/forms-core";
import { invalid, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadSubmission } from "./intake";
import type { SaveDraft } from "./save-draft";

interface Deps {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  extensions?: BindingInvoker;
}

async function recordContext<P extends "record_panel" | "action">(
  deps: Deps,
  ctx: TenantContext,
  scope: SubmissionScope,
  input: { submissionId: string; bindingId: string },
  point: P,
) {
  const submission = await deps.uow.run(ctx, (tx) =>
    loadSubmission(deps.submissions, tx, ctx, scope, input.submissionId),
  );

  const s = submission.toSnapshot();
  const release = await deps.catalog.getRelease(ctx, s.intakeReleaseId);

  const binding = release.extensions.find(
    (b) => b.id === input.bindingId && b.point === point && b.record === "submission",
  );

  if (!binding) throw notFound("Extension", input.bindingId);

  return {
    s,
    release,
    binding: binding as ExtensionBinding & { point: P },
    record: {
      type: "submission",
      id: s.id,
      number: s.number,
      status: s.status,
      insuredName: s.insuredName,
      effectiveDate: s.effectiveDate.toString(),
      jurisdiction: s.jurisdiction,
      product: { id: release.productId, version: release.version },
      risk: s.riskData,
    },
  };
}

export function makeSubmissionPanel(deps: Deps) {
  return async function submissionPanel(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; bindingId: string },
  ): Promise<DisplayBlock[] | null> {
    const { binding, record, s } = await recordContext(deps, ctx, scope, input, "record_panel");

    const output = await (deps.extensions ?? noExtensions).invoke(
      ctx,
      binding,
      { record },
      {
        type: "submission",
        id: s.id,
      },
    );

    return output?.blocks ?? null;
  };
}

/**
 * Runs an action from the submission page. A `risk_patch` changeset is applied through the same
 * save-draft command a user's edit goes through, and only while the submission is a draft.
 */
export function makeRunSubmissionAction(deps: Deps & { saveDraft: SaveDraft }) {
  return async function runSubmissionAction(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; bindingId: string; values: Record<string, unknown> },
  ): Promise<{ message: string | null; blocks: DisplayBlock[]; applied: string[] }> {
    const { binding, record, s, release } = await recordContext(deps, ctx, scope, input, "action");
    const values = checkActionInput(binding.inputFields ?? [], input.values);

    const output = await (deps.extensions ?? noExtensions).invoke(
      ctx,
      binding,
      { record, input: values },
      { type: "submission", id: s.id },
    );

    if (!output) return { message: null, blocks: [], applied: [] };

    let applied: string[] = [];

    if (output.changeset) {
      if (s.status !== "draft") {
        throw invalid("This action changes the risk, which only drafts allow", {
          reason: "not_a_draft",
        });
      }

      const known = schemaIndex(release.riskSchema);
      const changes = Object.entries(output.changeset.values).filter(([path]) => known.has(path));

      const riskData = changes.reduce(
        (data, [path, value]) => setAt(data, path, value),
        s.riskData,
      );

      await deps.saveDraft(ctx, scope, { id: s.id, riskData });
      applied = changes.map(([path]) => path);
    }

    return { message: output.message ?? null, blocks: output.blocks, applied };
  };
}

export type SubmissionPanel = ReturnType<typeof makeSubmissionPanel>;
export type RunSubmissionAction = ReturnType<typeof makeRunSubmissionAction>;

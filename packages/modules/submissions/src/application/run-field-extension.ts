import { type BindingInvoker, bindingsAt, noExtensions } from "@pas/extension-points";
import { schemaIndex } from "@pas/forms-core";
import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadSubmission } from "./intake";

interface Deps {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  extensions?: BindingInvoker;
}

async function context(deps: Deps, ctx: TenantContext, scope: SubmissionScope, id: string) {
  const submission = await deps.uow.run(ctx, (tx) =>
    loadSubmission(deps.submissions, tx, ctx, scope, id),
  );

  const s = submission.toSnapshot();
  const release = await deps.catalog.getRelease(ctx, s.intakeReleaseId);

  return {
    release,
    base: {
      jurisdiction: s.jurisdiction,
      product: { id: release.productId, version: release.version },
      effectiveDate: s.effectiveDate.toString(),
      channel: s.channel,
    },
    subject: { type: "submission", id: s.id },
  };
}

/** Options for a field from its `field_options` extension; none when it's skipped or fails. */
export function makeFieldOptions(deps: Deps) {
  return async function fieldOptions(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; field: string; values: Record<string, unknown> },
  ): Promise<{ value: string; label: string }[]> {
    const { release, base, subject } = await context(deps, ctx, scope, input.submissionId);

    const [binding] = bindingsAt(release.extensions, "field_options").filter(
      (b) => b.field === input.field,
    );

    if (!binding) return [];

    const output = await (deps.extensions ?? noExtensions).invoke(
      ctx,
      binding,
      { ...base, field: input.field, values: input.values },
      subject,
    );

    return output?.options ?? [];
  };
}

/**
 * Values to fill when a trigger field changes. Only paths in the risk schema come back; the
 * user can still edit them, and the server validates them like typed values on save.
 */
export function makeFieldPrefill(deps: Deps) {
  return async function fieldPrefill(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; field: string; path?: string; values: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    const { release, base, subject } = await context(deps, ctx, scope, input.submissionId);

    const bindings = bindingsAt(release.extensions, "field_prefill").filter(
      (b) => b.field === input.field,
    );

    const known = schemaIndex(release.riskSchema);

    const outputs = await Promise.all(
      bindings.map((binding) =>
        (deps.extensions ?? noExtensions).invoke(
          ctx,
          binding,
          { ...base, field: input.field, path: input.path ?? input.field, values: input.values },
          subject,
        ),
      ),
    );

    return Object.fromEntries(
      outputs
        .flatMap((output) => Object.entries(output?.values ?? {}))
        .filter(([path]) => known.has(path) && path !== input.field),
    );
  };
}

export type FieldOptions = ReturnType<typeof makeFieldOptions>;
export type FieldPrefill = ReturnType<typeof makeFieldPrefill>;

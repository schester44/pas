import { validateSubmission } from "@pas/forms-core";
import type { Clock, Outbox, TenantContext, UnitOfWork } from "@pas/kernel";
import type { RiskData } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionSummaryDto, toSummaryDto } from "./dto";
import { loadSubmission, pinnedIntake } from "./intake";

export type SubmitSubmissionResult =
  | { ok: true; submission: SubmissionSummaryDto }
  | { ok: false; errors: Record<string, string[]> };

export function makeSubmitSubmission(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  clock: Clock;
}) {
  return async function submitSubmission(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { id: string; riskData: RiskData },
  ): Promise<SubmitSubmissionResult> {
    const draft = await deps.uow.run(ctx, (tx) =>
      loadSubmission(deps.submissions, tx, ctx, scope, input.id),
    );

    const [productName, intake] = await Promise.all([
      deps.catalog.productName(ctx, draft.toSnapshot().productId),
      pinnedIntake(deps.catalog, ctx, draft),
    ]);

    const result = validateSubmission(intake.riskSchema, intake.form, input.riskData);

    return deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);

      if (!result.ok) {
        submission.saveDraft(input.riskData, deps.clock);
        await deps.submissions.save(tx, submission);

        return { ok: false, errors: result.errors };
      }

      submission.submit(result.data, deps.clock);
      await deps.submissions.save(tx, submission);
      await deps.outbox.add(tx, submission.pullEvents());

      return { ok: true, submission: toSummaryDto(submission, productName) };
    });
  };
}

export type SubmitSubmission = ReturnType<typeof makeSubmitSubmission>;

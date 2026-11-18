import type { Clock, TenantContext, UnitOfWork } from "@pas/kernel";
import type { RiskData } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadSubmission } from "./intake";

export function makeSaveDraft(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  clock: Clock;
}) {
  return async function saveDraft(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { id: string; riskData: RiskData },
  ): Promise<{ updatedAt: string }> {
    return deps.uow.run(ctx, async (tx) => {
      const submission = await loadSubmission(deps.submissions, tx, ctx, scope, input.id);
      submission.saveDraft(input.riskData, deps.clock);
      await deps.submissions.save(tx, submission);

      return { updatedAt: submission.toSnapshot().updatedAt.toString() };
    });
  };
}

export type SaveDraft = ReturnType<typeof makeSaveDraft>;

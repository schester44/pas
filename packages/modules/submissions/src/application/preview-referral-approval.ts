import type { TenantContext } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import { insuredValueOf, type ReferralModifications } from "../domain/underwriter-terms";
import type { makeDecideReferral } from "./decide-referral";
import { rerate } from "./decide-referral";
import type { MoneyDto } from "./quote-dto";

export interface ApprovalPreview {
  writtenPremium: MoneyDto;
  total: MoneyDto;
  insuredValue: MoneyDto;
  adjustment: MoneyDto | null;
}

/** What the quote would cost on the underwriter's terms, for the authority check (PLAN §11). */
export function makePreviewReferralApproval(deps: Parameters<typeof makeDecideReferral>[0]) {
  return async function previewReferralApproval(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; modifications: ReferralModifications },
  ): Promise<ApprovalPreview> {
    const { evaluation, selection } = await rerate(
      deps,
      ctx,
      scope,
      input.submissionId,
      input.modifications,
    );

    const currency = evaluation.total.currency;

    return {
      writtenPremium: evaluation.writtenPremium.toJSON(),
      total: evaluation.total.toJSON(),
      insuredValue: insuredValueOf(evaluation.offers, selection, currency).toJSON(),
      adjustment: evaluation.adjustment?.amount.toJSON() ?? null,
    };
  };
}

export type PreviewReferralApproval = ReturnType<typeof makePreviewReferralApproval>;

import type { TenantContext } from "@pas/kernel";
import type { UnderwritingDeps } from "./deps";

export interface ProducerActionsDto {
  questions: { submissionId: string; referralId: string; askedAt: string }[];
  conditions: {
    id: string;
    submissionId: string;
    policyId: string | null;
    title: string;
    dueDate: string | null;
  }[];
}

/** What underwriting is waiting on the producer for, across submissions the caller can see. */
export function makeListProducerActions(deps: UnderwritingDeps) {
  return async function listProducerActions(
    ctx: TenantContext,
    input: { submissionIds: readonly string[] },
  ): Promise<ProducerActionsDto> {
    if (input.submissionIds.length === 0) return { questions: [], conditions: [] };

    const [referrals, subjectivities] = await deps.uow.run(ctx, (tx) =>
      Promise.all([
        deps.referrals.list(tx, ctx, {
          statuses: ["info_requested"],
          submissionIds: input.submissionIds,
          limit: input.submissionIds.length,
        }),
        deps.subjectivities.listOpenBySubmissions(tx, ctx, input.submissionIds),
      ]),
    );

    return {
      questions: referrals.map((referral) => {
        const r = referral.toSnapshot();
        const asked = r.entries.findLast((e) => e.action === "info_requested");

        return {
          submissionId: r.submissionId,
          referralId: r.id,
          askedAt: (asked?.at ?? r.updatedAt).toString(),
        };
      }),
      conditions: subjectivities
        .map((s) => s.toSnapshot())
        .filter((s) => s.owner !== "underwriter")
        .map((s) => ({
          id: s.id,
          submissionId: s.submissionId,
          policyId: s.policyId,
          title: s.title,
          dueDate: s.dueDate?.toString() ?? null,
        })),
    };
  };
}

export type ListProducerActions = ReturnType<typeof makeListProducerActions>;

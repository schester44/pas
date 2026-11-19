import { invalid, type TenantContext } from "@pas/kernel";
import { clockOf, loadReferral, persist, personOf, type UnderwritingDeps } from "./deps";

/** Decline for configured reason codes; the adverse-action wording comes from tenant config. */
export function makeDeclineReferral(deps: UnderwritingDeps) {
  return async function declineReferral(
    ctx: TenantContext,
    input: { id: string; actorName: string; reasonCodes: string[]; note?: string },
  ) {
    const by = personOf(ctx, input.actorName);

    const { referral, settings } = await deps.uow.run(ctx, async (tx) => ({
      referral: await loadReferral(deps, tx, ctx, input.id),
      settings: await deps.settings.get(tx, ctx),
    }));

    const reasons = input.reasonCodes.map((code) => {
      const reason = settings.declineReasons.find((r) => r.code === code);

      if (!reason) throw invalid(`Unknown decline reason ${code}`, { field: "reasonCodes" });

      return reason;
    });

    if (reasons.length === 0) throw invalid("Choose at least one reason", { field: "reasonCodes" });

    const r = referral.toSnapshot();
    const facts = await deps.quotes.facts(ctx, { submissionId: r.submissionId });

    const notice = reasons
      .map((x) => x.adverseActionNotice)
      .filter(Boolean)
      .join("\n\n");

    if (facts.status === "referred") {
      await deps.quotes.decline(ctx, {
        submissionId: r.submissionId,
        underwriterName: by.name,
        ...(input.note && { note: input.note }),
        reasons: reasons.map((x) => ({ code: x.code, message: x.label })),
        ...(notice && { adverseActionNotice: notice }),
      });
    }

    await deps.uow.run(ctx, async (tx) => {
      const current = await loadReferral(deps, tx, ctx, input.id);

      current.decline(
        {
          by,
          note: input.note ?? null,
          changes: { reasonCodes: input.reasonCodes, adverseActionNotice: notice || null },
        },
        clockOf(deps, ctx),
      );

      await persist(deps, tx, current);
    });
  };
}

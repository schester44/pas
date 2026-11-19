import { invalid, jurisdictionTimeZone, type TenantContext } from "@pas/kernel";
import { Inspection, type ReviewOutcome } from "../domain/inspection";
import { Subjectivity } from "../domain/subjectivity";
import {
  clockOf,
  loadInspection,
  loadSubjectivity,
  persist,
  personOf,
  type UnderwritingDeps,
} from "./deps";
import { type InspectionDto, toInspectionDto } from "./dto";

/**
 * An underwriter reviews the report (PLAN §11). Findings never decline or non-renew on their own:
 * the reviewer turns recommendations into subjectivities, clears the inspection condition, or
 * sends someone to the property.
 */
export function makeReviewInspection(deps: UnderwritingDeps) {
  return async function reviewInspection(
    ctx: TenantContext,
    input: {
      id: string;
      outcome: ReviewOutcome;
      note?: string;
      subjectivityCodes: string[];
      actorName: string;
    },
  ): Promise<InspectionDto> {
    const by = personOf(ctx, input.actorName);
    const clock = clockOf(deps, ctx);

    const current = await deps.uow.run(ctx, (tx) => loadInspection(deps, tx, ctx, input.id));
    const s = current.toSnapshot();
    const facts = await deps.quotes.facts(ctx, { submissionId: s.submissionId });

    const boundOn =
      facts.policy && facts.boundAt
        ? facts.boundAt.toZonedDateTimeISO(jurisdictionTimeZone(facts.jurisdiction)).toPlainDate()
        : undefined;

    const recommendations = (s.report?.findings ?? []).flatMap((f) =>
      f.recommendation && input.subjectivityCodes.includes(f.recommendation.code)
        ? [{ ...f.recommendation, finding: f.label }]
        : [],
    );

    if (input.outcome === "conditions" && recommendations.length === 0) {
      throw invalid("Pick the recommendations that become subjectivities", {
        field: "subjectivityCodes",
      });
    }

    return deps.uow.run(ctx, async (tx) => {
      const settings = await deps.settings.get(tx, ctx);
      const inspection = await loadInspection(deps, tx, ctx, input.id);

      inspection.review(
        {
          outcome: input.outcome,
          note: input.note?.trim() || null,
          by,
          subjectivityCodes: recommendations.map((r) => r.code),
        },
        clock,
      );

      const added = recommendations.map((r) =>
        Subjectivity.create(
          {
            tenantId: ctx.tenantId,
            quoteId: s.quoteId,
            submissionId: s.submissionId,
            submissionNumber: s.submissionNumber,
            policyId: facts.policy?.id ?? null,
            policyNumber: facts.policy?.number ?? null,
            referralId: null,
            inspectionId: s.id,
            code: `${s.code}-${r.code}`,
            title: r.title,
            description: `From the inspection: ${r.finding}`,
            timing: "post_bind",
            dueDays: r.dueDays,
            owner: "insured",
            source: "inspection",
            consequence: settings.overdueConsequence,
          },
          by,
          clock,
          boundOn,
        ),
      );

      const followUp =
        input.outcome === "field_inspection"
          ? Inspection.request(
              {
                tenantId: ctx.tenantId,
                quoteId: s.quoteId,
                submissionId: s.submissionId,
                submissionNumber: s.submissionNumber,
                policyId: s.policyId,
                policyNumber: s.policyNumber,
                subjectivityId: s.subjectivityId,
                code: `${s.code}-FIELD`,
                type: "field",
                timing: s.timing,
                reason: `Field visit after the ${s.type.replace("_", " ")} review`,
                address: s.address,
              },
              clock,
            )
          : null;

      const condition =
        s.subjectivityId && input.outcome !== "field_inspection"
          ? await loadSubjectivity(deps, tx, ctx, s.subjectivityId)
          : null;

      if (condition?.isOpen) condition.accept(by, `Inspection reviewed: ${input.outcome}`, clock);

      await persist(
        deps,
        tx,
        inspection,
        ...added,
        ...(followUp ? [followUp] : []),
        ...(condition ? [condition] : []),
      );

      await deps.timeline.record(tx, ctx, {
        quoteId: s.quoteId,
        policyId: s.policyId,
        type: "inspection_reviewed",
        actor: { type: "user", ...(by.id && { id: by.id }), name: by.name },
        summary: `Inspection reviewed by ${by.name}: ${input.outcome.replace("_", " ")}${added.length ? `, ${added.length} subjectivities added` : ""}`,
        data: { inspectionId: s.id, outcome: input.outcome },
      });

      return toInspectionDto(inspection);
    });
  };
}

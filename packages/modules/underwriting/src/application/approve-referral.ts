import type { SubjectivityOwner, SubjectivityTiming } from "@pas/decisions-engine";
import { DomainError, newId, type TenantContext } from "@pas/kernel";
import { checkAuthority } from "../domain/authority";
import { Subjectivity } from "../domain/subjectivity";
import type { UnderwriterTerms } from "../ports/quote-desk";
import { clockOf, loadReferral, persist, personOf, type UnderwritingDeps } from "./deps";

export interface AddedSubjectivity {
  title: string;
  description?: string;
  timing: SubjectivityTiming;
  dueDays?: number;
  owner: SubjectivityOwner;
}

export type ApprovalOutcome =
  | { outcome: "approved" }
  | { outcome: "escalated"; problems: string[]; level: number };

const modified = (terms: UnderwriterTerms) =>
  terms.coverages.length > 0 || terms.adjustment !== null;

/**
 * Approve a referral, optionally on changed terms and with subjectivities (PLAN §11). Beyond the
 * approver's authority it escalates instead; either way the decision and its changes are audited.
 */
export function makeApproveReferral(deps: UnderwritingDeps) {
  return async function approveReferral(
    ctx: TenantContext,
    input: {
      id: string;
      actorName: string;
      note?: string;
      conditions: string[];
      terms: UnderwriterTerms;
      subjectivities: AddedSubjectivity[];
    },
  ): Promise<ApprovalOutcome> {
    const clock = clockOf(deps, ctx);
    const by = personOf(ctx, input.actorName);

    const { referral, settings } = await deps.uow.run(ctx, async (tx) => ({
      referral: await loadReferral(deps, tx, ctx, input.id),
      settings: await deps.settings.get(tx, ctx),
    }));

    const r = referral.toSnapshot();
    const facts = await deps.quotes.facts(ctx, { submissionId: r.submissionId });

    const figures = modified(input.terms)
      ? await deps.quotes.preview(ctx, { submissionId: r.submissionId, terms: input.terms })
      : facts;

    const member = by.id ? await deps.staff.member(ctx, by.id) : null;

    const check = checkAuthority(
      settings.authorityProfiles,
      { userId: by.id ?? "", roles: member?.roles ?? [] },
      {
        productId: r.productId,
        jurisdiction: r.jurisdiction,
        writtenPremium: figures.writtenPremium,
        insuredValue: figures.insuredValue,
        authorities: r.quote.reasons.flatMap((x) => (x.authority ? [x.authority] : [])),
      },
    );

    const changes = {
      terms: input.terms,
      conditions: input.conditions,
      subjectivities: input.subjectivities.map((s) => s.title),
      writtenPremium: figures.writtenPremium.toJSON(),
      insuredValue: figures.insuredValue.toJSON(),
    };

    if (!check.ok) {
      if (r.status === "escalated" && r.requiredLevel >= check.escalateTo) {
        throw new DomainError("forbidden", `Beyond your authority: ${check.problems.join("; ")}`, {
          reason: "authority",
          problems: check.problems,
        });
      }

      await deps.uow.run(ctx, async (tx) => {
        const current = await loadReferral(deps, tx, ctx, input.id);

        current.escalate(
          { level: check.escalateTo, problems: check.problems, by, proposal: changes },
          clock,
        );

        await persist(deps, tx, current);

        await deps.timeline.record(tx, ctx, {
          quoteId: r.quoteId,
          policyId: null,
          type: "uw_escalated",
          actor: { type: "user", ...(by.id && { id: by.id }), name: by.name },
          summary: `Escalated by ${by.name}: ${check.problems.join("; ")}`,
          data: { referralId: r.id, level: check.escalateTo },
        });
      });

      return { outcome: "escalated", problems: check.problems, level: check.escalateTo };
    }

    if (facts.status === "referred") {
      await deps.quotes.approve(ctx, {
        submissionId: r.submissionId,
        underwriterName: by.name,
        ...(input.note && { note: input.note }),
        conditions: input.conditions,
        terms: input.terms,
      });
    }

    await deps.uow.run(ctx, async (tx) => {
      const current = await loadReferral(deps, tx, ctx, input.id);

      current.approve({ by, level: check.profile.level, note: input.note ?? null, changes }, clock);

      const added = input.subjectivities.map((s) =>
        Subjectivity.create(
          {
            tenantId: ctx.tenantId,
            quoteId: r.quoteId,
            submissionId: r.submissionId,
            submissionNumber: r.submissionNumber,
            policyId: null,
            policyNumber: null,
            referralId: r.id,
            inspectionId: null,
            code: `UW-${newId().slice(-6).toUpperCase()}`,
            title: s.title,
            description: s.description ?? null,
            timing: s.timing,
            dueDays: s.dueDays ?? null,
            owner: s.owner,
            source: "underwriter",
            consequence: settings.overdueConsequence,
          },
          by,
          clock,
        ),
      );

      await persist(deps, tx, current, ...added);

      for (const s of added) {
        await deps.timeline.record(tx, ctx, {
          quoteId: r.quoteId,
          policyId: null,
          type: "subjectivity_added",
          actor: { type: "user", ...(by.id && { id: by.id }), name: by.name },
          summary: `Subjectivity added: ${s.toSnapshot().title}`,
          data: { subjectivityId: s.id, timing: s.toSnapshot().timing },
        });
      }
    });

    return { outcome: "approved" };
  };
}

export type ApproveReferral = ReturnType<typeof makeApproveReferral>;

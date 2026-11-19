import { jurisdictionTimeZone, type TenantContext } from "@pas/kernel";
import { Inspection } from "../domain/inspection";
import type { Person } from "../domain/referral";
import { Subjectivity } from "../domain/subjectivity";
import type { DecidedSubjectivity, RequiredInspection } from "../ports/quote-desk";
import { clockOf, persist, type UnderwritingDeps } from "./deps";

const RULES: Person = { id: null, name: "Underwriting rules" };

const INSPECTION_LABEL: Record<RequiredInspection["type"], string> = {
  exterior: "exterior",
  interior_exterior: "interior and exterior",
  aerial: "aerial imagery",
  field: "field",
};

const inspectionCondition = (i: RequiredInspection): DecidedSubjectivity => ({
  code: `INSPECTION-${i.code}`,
  title: `Satisfactory ${INSPECTION_LABEL[i.type]} inspection`,
  description: i.reason,
  timing: "pre_bind",
  owner: "underwriter",
});

/**
 * Keeps a quote's subjectivities and inspections in line with its decisions (PLAN §7.2): rules
 * add and drop untouched conditions as the quote changes; binding starts the post-bind clock and
 * orders the post-bind inspections. Idempotent, so every quote event can call it.
 */
export function makeSyncQuoteConditions(deps: UnderwritingDeps) {
  return async function syncQuoteConditions(ctx: TenantContext, input: { submissionId: string }) {
    const facts = await deps.quotes.facts(ctx, input);

    if (facts.status === "declined" || facts.status === "expired") {
      return { changed: 0, awaitingOrder: [], awaitingDue: [] };
    }

    const clock = clockOf(deps, ctx);

    const boundOn =
      facts.boundAt &&
      facts.boundAt.toZonedDateTimeISO(jurisdictionTimeZone(facts.jurisdiction)).toPlainDate();

    return deps.uow.run(ctx, async (tx) => {
      const settings = await deps.settings.get(tx, ctx);
      const subjectivities = await deps.subjectivities.listByQuote(tx, ctx, facts.quoteId);
      const inspections = await deps.inspections.listByQuote(tx, ctx, facts.quoteId);
      const changed: (Subjectivity | Inspection)[] = [];
      const bound = facts.policy !== null && boundOn !== null;

      const preBindInspections = facts.inspections.filter((i) => i.timing === "pre_bind");
      const wanted = [...facts.subjectivities, ...preBindInspections.map(inspectionCondition)];

      for (const decided of wanted) {
        const found = subjectivities.find((s) => s.toSnapshot().code === decided.code);
        const fields = fieldsOf(decided, settings.overdueConsequence);

        if (!found) {
          if (bound && decided.timing === "pre_bind") continue;

          const created = Subjectivity.create(
            {
              tenantId: ctx.tenantId,
              quoteId: facts.quoteId,
              submissionId: facts.submissionId,
              submissionNumber: facts.submissionNumber,
              policyId: null,
              policyNumber: null,
              referralId: null,
              inspectionId: null,
              code: decided.code,
              source: decided.code.startsWith("INSPECTION-") ? "inspection" : "decision",
              ...fields,
            },
            RULES,
            clock,
          );

          subjectivities.push(created);
          changed.push(created);
        } else if (untouched(found) && !bound) {
          found.revise(fields, clock);
          changed.push(found);
        }
      }

      for (const s of subjectivities) {
        const snap = s.toSnapshot();
        const stillWanted = wanted.some((w) => w.code === snap.code);

        if (!bound && snap.source !== "underwriter" && !stillWanted && untouched(s)) {
          await deps.subjectivities.remove(tx, ctx, s.id);
        }
      }

      for (const required of facts.inspections) {
        if (inspections.some((i) => i.toSnapshot().type === required.type)) continue;

        const ready = required.timing === "pre_bind" ? facts.status === "quoted" && !bound : bound;

        if (!ready || !facts.location) continue;

        const condition = subjectivities.find(
          (s) => s.toSnapshot().code === inspectionCondition(required).code,
        );

        const inspection = Inspection.request(
          {
            tenantId: ctx.tenantId,
            quoteId: facts.quoteId,
            submissionId: facts.submissionId,
            submissionNumber: facts.submissionNumber,
            policyId: facts.policy?.id ?? null,
            policyNumber: facts.policy?.number ?? null,
            subjectivityId: condition?.id ?? null,
            code: required.code,
            type: required.type,
            timing: required.timing,
            reason: required.reason,
            address: facts.location,
          },
          clock,
        );

        inspections.push(inspection);
        changed.push(inspection);
      }

      if (bound) {
        for (const s of subjectivities) {
          if (!s.toSnapshot().policyId) {
            s.activate(facts.policy!, boundOn!, clock);
            changed.push(s);
          }
        }

        for (const i of inspections) {
          if (!i.toSnapshot().policyId) {
            i.linkPolicy(facts.policy!, clock);
            changed.push(i);
          }
        }
      }

      await persist(deps, tx, ...new Set(changed));

      return {
        changed: changed.length,
        awaitingOrder: inspections.filter((i) => i.status === "requested").map((i) => i.id),
        awaitingDue: subjectivities
          .filter((x) => x.isOpen && x.toSnapshot().dueDate !== null)
          .map((x) => x.id),
      };
    });
  };
}

const untouched = (s: Subjectivity) => {
  const snap = s.toSnapshot();

  return snap.status === "open" && snap.documents.length === 0 && snap.source !== "underwriter";
};

function fieldsOf(decided: DecidedSubjectivity, fallbackConsequence: string | null) {
  return {
    title: decided.title,
    description: decided.description ?? null,
    timing: decided.timing,
    dueDays: decided.dueDays ?? null,
    owner: decided.owner ?? "producer",
    consequence: decided.consequence ?? fallbackConsequence,
  };
}

/** Pre-bind subjectivities the quote can't bind without (the submissions `BindConditions` port). */
export function makeOutstandingConditions(deps: UnderwritingDeps) {
  const sync = makeSyncQuoteConditions(deps);

  return async function outstanding(
    ctx: TenantContext,
    input: { quoteId: string; submissionId: string },
  ): Promise<{ title: string }[]> {
    await sync(ctx, { submissionId: input.submissionId });

    const subjectivities = await deps.uow.run(ctx, (tx) =>
      deps.subjectivities.listByQuote(tx, ctx, input.quoteId),
    );

    return subjectivities
      .map((s) => s.toSnapshot())
      .filter((s) => s.timing === "pre_bind" && (s.status === "open" || s.status === "received"))
      .map((s) => ({ title: s.title }));
  };
}

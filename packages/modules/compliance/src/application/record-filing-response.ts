import { conflict, type TenantContext, type Transaction } from "@pas/kernel";
import type { Obligation } from "../domain/obligation";
import { type ComplianceDeps, loadObligation, persist, recordOnPolicy, userActor } from "./deps";
import { type ObligationDetailDto, toDetailDto } from "./dto";

/** A remitted period discharges the filings it covered: they move from accepted to completed. */
async function completeCovered(
  deps: ComplianceDeps,
  tx: Transaction,
  ctx: TenantContext,
  period: Obligation,
  actorName: string,
) {
  const s = period.toSnapshot();
  const clock = deps.clocks.forTenant(ctx.tenantId);

  if (s.subject.type !== "period" || !s.subject.periodStart || !s.subject.periodEnd) return;

  period.complete({ actor: userActor(ctx, actorName), summary: "Remitted" }, clock);

  const covered = await deps.obligations.inPeriod(tx, ctx, {
    kind: s.data.aggregates as never,
    jurisdiction: s.jurisdiction.subdivision ?? s.jurisdiction.country,
    licenseeId: s.responsible.licensee?.id ?? null,
    from: s.subject.periodStart,
    to: s.subject.periodEnd,
  });

  for (const o of covered.filter((c) => c.status === "accepted")) {
    o.complete(
      {
        actor: { type: "system", name: "Compliance" },
        summary: `Taxes remitted with ${s.title.toLowerCase()}`,
      },
      clock,
    );

    await persist(deps, tx, o);
  }
}

/** Records what a portal or office answered for a filing made by hand or by file. */
export function makeRecordFilingResponse(deps: ComplianceDeps) {
  return async function recordFilingResponse(
    ctx: TenantContext,
    input:
      | {
          obligationId: string;
          outcome: "accepted";
          filingNumber?: string;
          stampNumber?: string;
          actorName: string;
        }
      | { obligationId: string; outcome: "rejected"; reasons: string[]; actorName: string },
  ): Promise<ObligationDetailDto> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    return deps.uow.run(ctx, async (tx) => {
      const obligation = await loadObligation(deps, tx, ctx, input.obligationId);
      const filing = obligation.latestFiling;

      if (!filing || obligation.status !== "submitted")
        throw conflict("Nothing is awaiting an answer");

      const actor = userActor(ctx, input.actorName);

      if (input.outcome === "accepted") {
        obligation.accept(
          filing.id,
          {
            filingNumber: input.filingNumber?.trim() || null,
            stampNumber: input.stampNumber?.trim() || null,
            actor,
          },
          clock,
        );

        await recordOnPolicy(
          deps,
          tx,
          ctx,
          obligation,
          "filing_accepted",
          input.filingNumber?.trim(),
        );

        await completeCovered(deps, tx, ctx, obligation, input.actorName);
      } else {
        obligation.reject(
          filing.id,
          { reasons: input.reasons.map((r) => r.trim()).filter(Boolean), actor },
          clock,
        );

        await recordOnPolicy(
          deps,
          tx,
          ctx,
          obligation,
          "filing_rejected",
          input.reasons.join("; "),
        );
      }

      await persist(deps, tx, obligation);

      return toDetailDto(obligation, clock.now());
    });
  };
}

export type RecordFilingResponse = ReturnType<typeof makeRecordFilingResponse>;

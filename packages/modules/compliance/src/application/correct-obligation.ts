import { jurisdictionCode, type TenantContext } from "@pas/kernel";
import { licenseeFor } from "../domain/licensee";
import { type ComplianceDeps, loadObligation, persist, userActor } from "./deps";
import { type ObligationDetailDto, toDetailDto } from "./dto";

const EDITABLE = ["insuredName", "effectiveDate", "expirationDate"] as const;

/** Addresses a rejection; the next submission carries the correction note. */
export function makeCorrectObligation(deps: ComplianceDeps) {
  return async function correctObligation(
    ctx: TenantContext,
    input: {
      obligationId: string;
      note: string;
      corrections: Partial<Record<(typeof EDITABLE)[number], string>>;
      actorName: string;
    },
  ): Promise<ObligationDetailDto> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const corrections = Object.fromEntries(
      EDITABLE.filter((k) => input.corrections[k]?.trim()).map((k) => [
        k,
        input.corrections[k]!.trim(),
      ]),
    );

    return deps.uow.run(ctx, async (tx) => {
      const obligation = await loadObligation(deps, tx, ctx, input.obligationId);

      const actor = userActor(ctx, input.actorName);
      const s = obligation.toSnapshot();

      const licensee = s.responsible.licensee
        ? null
        : licenseeFor(await deps.licensees.list(tx, ctx), jurisdictionCode(s.jurisdiction));

      obligation.correct({ note: input.note, corrections, actor }, clock);

      if (licensee) {
        obligation.assignLicensee(
          {
            id: licensee.id,
            name: licensee.name,
            licenseNumber: licensee.licenseNumber,
            jurisdiction: licensee.jurisdiction,
          },
          actor,
          clock,
        );
      }

      await persist(deps, tx, obligation);

      return toDetailDto(obligation, clock.now());
    });
  };
}

export type CorrectObligation = ReturnType<typeof makeCorrectObligation>;

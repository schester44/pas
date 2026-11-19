import { newId, type TenantContext } from "@pas/kernel";
import type { ProofFile } from "../domain/obligation";
import { type ComplianceDeps, loadObligation, persist, recordOnPolicy, userActor } from "./deps";
import { type ObligationDetailDto, toDetailDto } from "./dto";

/** Records a filing made outside the system, with its confirmation and proof files. */
export function makeMarkObligationSubmitted(deps: ComplianceDeps) {
  return async function markObligationSubmitted(
    ctx: TenantContext,
    input: {
      obligationId: string;
      filingNumber?: string;
      note?: string;
      files: { name: string; contentType: string; body: Uint8Array }[];
      actorName: string;
    },
  ): Promise<ObligationDetailDto> {
    const clock = deps.clocks.forTenant(ctx.tenantId);
    const files: ProofFile[] = [];

    for (const file of input.files) {
      const key = `tenants/${ctx.tenantId}/compliance/obligations/${input.obligationId}/${newId()}-${file.name.replace(/[^\w.-]+/g, "_")}`;

      await deps.storage.put({ key, body: file.body, contentType: file.contentType });

      files.push({
        key,
        name: file.name,
        contentType: file.contentType,
        sizeBytes: file.body.byteLength,
      });
    }

    return deps.uow.run(ctx, async (tx) => {
      const obligation = await loadObligation(deps, tx, ctx, input.obligationId);

      obligation.markSubmitted(
        {
          proof: {
            filingNumber: input.filingNumber?.trim() || null,
            stampNumber: null,
            note: input.note?.trim() || null,
            files,
          },
          actor: userActor(ctx, input.actorName),
        },
        clock,
      );

      await recordOnPolicy(deps, tx, ctx, obligation, "filing_submitted", "recorded by hand");
      await persist(deps, tx, obligation);

      return toDetailDto(obligation, clock.now());
    });
  };
}

export type MarkObligationSubmitted = ReturnType<typeof makeMarkObligationSubmitted>;

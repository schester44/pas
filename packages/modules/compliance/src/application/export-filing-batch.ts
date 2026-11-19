import {
  conflict,
  DomainError,
  jurisdictionCode,
  newId,
  notFound,
  type TenantContext,
} from "@pas/kernel";
import type { FilingBatch } from "../ports/obligation-repository";
import { type ComplianceDeps, loadObligation, persist, userActor } from "./deps";
import { filingRequestOf } from "./dto";
import { channelFor } from "./submit-obligation";

export interface FilingBatchDto {
  id: string;
  providerId: string;
  kind: string;
  jurisdiction: string;
  fileName: string;
  checklist: string[];
  obligationIds: string[];
  createdAt: string;
}

const toBatchDto = (b: FilingBatch): FilingBatchDto => ({
  id: b.id,
  providerId: b.providerId,
  kind: b.kind,
  jurisdiction: b.jurisdiction,
  fileName: b.fileName,
  checklist: b.checklist,
  obligationIds: b.obligationIds,
  createdAt: b.createdAt.toString(),
});

/** Generates one upload file plus a checklist for obligations filed by hand on a portal (PLAN §17.2.7). */
export function makeExportFilingBatch(deps: ComplianceDeps) {
  return {
    async export(
      ctx: TenantContext,
      input: { obligationIds: string[]; providerId?: string; actorName: string },
    ): Promise<FilingBatchDto> {
      const clock = deps.clocks.forTenant(ctx.tenantId);

      const obligations = await deps.uow.run(ctx, (tx) =>
        Promise.all(input.obligationIds.map((id) => loadObligation(deps, tx, ctx, id))),
      );

      const first = obligations[0];

      if (!first) throw conflict("Choose obligations to export");

      if (obligations.some((o) => !o.isOpen))
        throw conflict("Only open obligations can be exported");

      const channel = await channelFor(deps, ctx, first, input.providerId);

      if (channel.delivery !== "file_export" || !channel.exportBatch) {
        throw new DomainError("precondition_failed", `${channel.name} doesn't export files`);
      }

      for (const o of obligations) {
        const s = o.toSnapshot();

        if (!channel.serves(s.kind, jurisdictionCode(s.jurisdiction))) {
          throw conflict(
            `${channel.name} doesn't file ${s.title.toLowerCase()} in ${jurisdictionCode(s.jurisdiction)}`,
          );
        }
      }

      const batchId = newId();

      const exported = await channel.exportBatch(ctx, {
        batchId,
        requests: obligations.map((o) => filingRequestOf(o)),
      });

      const fileKey = `tenants/${ctx.tenantId}/compliance/batches/${batchId}/${exported.fileName}`;

      await deps.storage.put({
        key: fileKey,
        body: exported.body,
        contentType: exported.contentType,
      });

      const s = first.toSnapshot();

      const batch: FilingBatch = {
        id: batchId,
        providerId: channel.provider,
        kind: s.kind,
        jurisdiction: jurisdictionCode(s.jurisdiction),
        fileKey,
        fileName: exported.fileName,
        contentType: exported.contentType,
        checklist: exported.checklist,
        obligationIds: input.obligationIds,
        createdAt: clock.now(),
      };

      await deps.uow.run(ctx, async (tx) => {
        await deps.obligations.saveBatch(tx, ctx, batch);

        for (const id of input.obligationIds) {
          const current = await loadObligation(deps, tx, ctx, id);

          current.recordSubmission(
            {
              providerId: channel.provider,
              delivery: "file_export",
              reference: exported.fileName,
              batchId,
              actor: userActor(ctx, input.actorName),
            },
            clock,
          );

          await persist(deps, tx, current);
        }
      });

      return toBatchDto(batch);
    },

    async list(ctx: TenantContext): Promise<FilingBatchDto[]> {
      return (await deps.uow.run(ctx, (tx) => deps.obligations.listBatches(tx, ctx, 50))).map(
        toBatchDto,
      );
    },

    async file(ctx: TenantContext, input: { batchId: string }) {
      const batch = await deps.uow.run(ctx, (tx) =>
        deps.obligations.findBatch(tx, ctx, input.batchId),
      );

      const stored = batch && (await deps.storage.get(batch.fileKey));

      if (!batch || !stored) throw notFound("Filing batch", input.batchId);

      return { fileName: batch.fileName, contentType: batch.contentType, body: stored.body };
    },
  };
}

export type ExportFilingBatch = ReturnType<typeof makeExportFilingBatch>;

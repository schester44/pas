import {
  invalid,
  newId,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import { loadWorkbook } from "@pas/rating-engine";
import type { ObjectStorage } from "@pas/storage";
import { RaterWorkbook, type RaterWorkbookId } from "../domain/rater-workbook";
import type { RaterWorkbookRepository } from "../ports/rater-workbook-repository";
import { type RaterWorkbookDto, toRaterWorkbookDto } from "./dto";

export const MAX_RATER_WORKBOOK_BYTES = 10 * 1024 * 1024;

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface UploadRaterWorkbookInput {
  name: string;
  fileName: string;
  file: Uint8Array;
}

const isZip = (bytes: Uint8Array) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

export function makeUploadRaterWorkbook(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  workbooks: RaterWorkbookRepository;
  storage: ObjectStorage;
  clocks: ClockProvider;
}) {
  return async function uploadRaterWorkbook(
    ctx: TenantContext,
    input: UploadRaterWorkbookInput,
  ): Promise<RaterWorkbookDto> {
    const { file } = input;

    if (file.byteLength > MAX_RATER_WORKBOOK_BYTES) {
      throw invalid("Upload a workbook smaller than 10 MB", { field: "file" });
    }

    if (!isZip(file)) throw invalid("Upload an .xlsx workbook", { field: "file" });

    const loaded = await loadWorkbook(file);
    const sha256 = loaded.report.hash;

    const existing = await deps.uow.run(ctx, (tx) => deps.workbooks.findBySha256(tx, ctx, sha256));

    if (existing) return toRaterWorkbookDto(existing);

    const id = newId<"RaterWorkbook">() as RaterWorkbookId;
    const storageKey = `tenants/${ctx.tenantId}/rater-workbooks/${id}.xlsx`;

    const workbook = RaterWorkbook.upload(
      {
        id,
        tenantId: ctx.tenantId,
        name: input.name || input.fileName.replace(/\.xlsx$/i, ""),
        fileName: input.fileName,
        file: { storageKey, sha256, sizeBytes: file.byteLength },
        report: loaded.report,
        createdBy: ctx.actor.type === "user" ? ctx.actor.userId : ctx.actor.type,
      },
      deps.clocks.forTenant(ctx.tenantId),
    );

    return deps.uow.run(ctx, async (tx) => {
      await deps.storage.put({ key: storageKey, body: file, contentType: XLSX_CONTENT_TYPE });
      await deps.workbooks.insert(tx, workbook);
      await deps.outbox.add(tx, workbook.pullEvents());

      return toRaterWorkbookDto(workbook);
    });
  };
}

export type UploadRaterWorkbook = ReturnType<typeof makeUploadRaterWorkbook>;

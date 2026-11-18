import { asId, type TenantContext, type UnitOfWork } from "@pas/kernel";
import { loadWorkbook, type WorkbookModel } from "@pas/rating-engine";
import type { ObjectStorage } from "@pas/storage";
import type { RaterWorkbook } from "../domain/rater-workbook";
import type { RaterWorkbookRepository } from "../ports/rater-workbook-repository";

const LIMIT = 32;

export interface LoadedRaterWorkbook {
  workbook: RaterWorkbook;
  model: WorkbookModel;
}

/** Parsed models are cached by content hash: uploaded workbooks never change. */
export function makeWorkbookModels(deps: {
  uow: UnitOfWork;
  workbooks: RaterWorkbookRepository;
  storage: ObjectStorage;
}) {
  const models = new Map<string, WorkbookModel>();

  return async function workbookModel(
    ctx: TenantContext,
    id: string,
  ): Promise<LoadedRaterWorkbook | null> {
    const workbook = await deps.uow.run(ctx, (tx) => deps.workbooks.findById(tx, ctx, asId(id)));

    if (!workbook) return null;

    const { file } = workbook.toSnapshot();
    const cached = models.get(file.sha256);

    if (cached) return { workbook, model: cached };

    const stored = await deps.storage.get(file.storageKey);

    if (!stored) return null;

    const loaded = await loadWorkbook(stored.body);

    if (!loaded.ok) return null;

    if (models.size >= LIMIT) models.delete(models.keys().next().value!);

    models.set(file.sha256, loaded.workbook);

    return { workbook, model: loaded.workbook };
  };
}

export type WorkbookModels = ReturnType<typeof makeWorkbookModels>;

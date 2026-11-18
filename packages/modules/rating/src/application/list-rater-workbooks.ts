import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { RaterWorkbookRepository } from "../ports/rater-workbook-repository";
import { type RaterWorkbookDto, toRaterWorkbookDto } from "./dto";

export function makeListRaterWorkbooks(deps: {
  uow: UnitOfWork;
  workbooks: RaterWorkbookRepository;
}) {
  return async function listRaterWorkbooks(ctx: TenantContext): Promise<RaterWorkbookDto[]> {
    return deps.uow.run(ctx, async (tx) =>
      (await deps.workbooks.list(tx, ctx)).map(toRaterWorkbookDto),
    );
  };
}

export type ListRaterWorkbooks = ReturnType<typeof makeListRaterWorkbooks>;

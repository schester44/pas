import { notFound, type TenantContext } from "@pas/kernel";
import { formatRange } from "@pas/rating-engine";
import { type RaterWorkbookDetailDto, toRaterWorkbookDto } from "./dto";
import type { WorkbookModels } from "./workbook-models";

export function makeGetRaterWorkbook(deps: { models: WorkbookModels }) {
  return async function getRaterWorkbook(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<RaterWorkbookDetailDto> {
    const loaded = await deps.models(ctx, input.id);

    if (!loaded) throw notFound("Rater workbook", input.id);

    const { model } = loaded;

    return {
      ...toRaterWorkbookDto(loaded.workbook),
      sheets: model.sheets.map((sheet) => ({
        name: sheet.name,
        cells: Object.entries(sheet.cells).map(([address, cell]) => ({
          address,
          value: cell.value,
          ...(cell.formula && { formula: cell.formula }),
        })),
      })),
      names: Object.entries(model.names).map(([name, range]) => ({
        name,
        ref: formatRange(range),
      })),
    };
  };
}

export type GetRaterWorkbook = ReturnType<typeof makeGetRaterWorkbook>;

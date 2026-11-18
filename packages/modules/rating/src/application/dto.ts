import type { CellValue, WorkbookReport } from "@pas/rating-engine";
import type { RaterWorkbook } from "../domain/rater-workbook";

export interface RaterWorkbookDto {
  id: string;
  name: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  report: WorkbookReport;
  createdBy: string;
  createdAt: string;
}

export interface WorkbookCellDto {
  address: string;
  value: CellValue;
  formula?: string;
}

export interface RaterWorkbookDetailDto extends RaterWorkbookDto {
  sheets: { name: string; cells: WorkbookCellDto[] }[];
  names: { name: string; ref: string }[];
}

export function toRaterWorkbookDto(workbook: RaterWorkbook): RaterWorkbookDto {
  const w = workbook.toSnapshot();

  return {
    id: w.id,
    name: w.name,
    fileName: w.fileName,
    sha256: w.file.sha256,
    sizeBytes: w.file.sizeBytes,
    report: w.report,
    createdBy: w.createdBy,
    createdAt: w.createdAt.toString(),
  };
}

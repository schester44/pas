import type { SheetRange } from "./address";

export type CellValue = number | string | boolean | null | { error: string };

export interface CellModel {
  value: CellValue;
  formula?: string;
}

export interface SheetModel {
  name: string;
  cells: Record<string, CellModel>;
}

export interface WorkbookModel {
  hash: string;
  sheets: SheetModel[];
  names: Record<string, SheetRange>;
}

export type WorkbookProblemCode =
  | "unreadable"
  | "macros"
  | "external_links"
  | "unsupported_function"
  | "formula_error"
  | "circular_reference"
  | "array_formula"
  | "unsupported_name";

export interface WorkbookProblem {
  code: WorkbookProblemCode;
  message: string;
  cell?: string;
}

export interface FunctionUse {
  name: string;
  count: number;
  supported: boolean;
  reason?: string;
}

export interface WorkbookNotice {
  code: "result_mismatch";
  message: string;
  cell: string;
}

export interface WorkbookReport {
  ok: boolean;
  hash: string;
  sheets: string[];
  names: string[];
  formulaCount: number;
  functions: FunctionUse[];
  unsupported: string[];
  problems: WorkbookProblem[];
  notices: WorkbookNotice[];
}

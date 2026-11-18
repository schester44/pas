import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { parseRange, type SheetRange } from "./address";
import { WorkbookEngine } from "./engine";
import { functionSupport } from "./functions";
import type { CellModel, CellValue, WorkbookModel, WorkbookProblem, WorkbookReport } from "./model";
import { warmEngine } from "./warm";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Entry names from the zip central directory; macros and external links show up as parts. */
function zipEntries(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;

  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }

  if (end < 0) return [];

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const names: string[] = [];
  const decoder = new TextDecoder();

  for (let i = 0; i < count && offset + 46 <= bytes.length; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

function plainValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;

  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean")
    return value;

  if (value instanceof Date) return (value.getTime() - EXCEL_EPOCH_MS) / DAY_MS;

  if ("error" in value) return { error: String(value.error) };

  if ("richText" in value) return value.richText.map((part) => part.text).join("");

  if ("text" in value && typeof value.text === "string") return value.text;

  if ("result" in value) return plainValue((value.result ?? null) as ExcelJS.CellValue);

  return null;
}

function readNames(
  workbook: ExcelJS.Workbook,
  problems: WorkbookProblem[],
): Record<string, SheetRange> {
  const names: Record<string, SheetRange> = {};
  const model = workbook.definedNames.model as unknown as { name: string; ranges: string[] }[];

  for (const { name, ranges } of model) {
    const range = ranges.length === 1 ? parseRange(ranges[0]!) : undefined;

    if (!range) {
      problems.push({
        code: "unsupported_name",
        message: `The name ${name} must refer to one cell or range (${ranges.join(", ") || "no range"})`,
      });

      continue;
    }

    names[name] = range;
  }

  return names;
}

function readSheets(workbook: ExcelJS.Workbook, problems: WorkbookProblem[]) {
  const results = new Map<string, CellValue>();

  const sheets = workbook.worksheets.map((worksheet) => {
    const cells: Record<string, CellModel> = {};

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master !== cell) return;

        const value = cell.value as ExcelJS.CellValue & { shareType?: string; ref?: string };
        const formula = cell.formula;

        if (formula) {
          if (value && typeof value === "object" && value.shareType === "array") {
            problems.push({
              code: "array_formula",
              message: `${worksheet.name}!${cell.address} is an array formula`,
              cell: `${worksheet.name}!${cell.address}`,
            });
          }

          cells[cell.address] = { value: plainValue(cell.result as ExcelJS.CellValue), formula };
          results.set(`${worksheet.name}!${cell.address}`, cells[cell.address]!.value);
        } else {
          cells[cell.address] = { value: plainValue(value) };
        }
      });
    });

    return { name: worksheet.name, cells };
  });

  return { sheets, results };
}

function differs(cached: CellValue, computed: CellValue): boolean {
  if (cached === null) return false;

  if (typeof cached === "number" && typeof computed === "number") {
    return Math.abs(cached - computed) > 1e-9 * Math.max(1, Math.abs(cached));
  }

  return JSON.stringify(cached) !== JSON.stringify(computed);
}

export type LoadedWorkbook =
  | { ok: true; workbook: WorkbookModel; report: WorkbookReport }
  | { ok: false; report: WorkbookReport };

export async function loadWorkbook(bytes: Uint8Array): Promise<LoadedWorkbook> {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const problems: WorkbookProblem[] = [];

  const report: WorkbookReport = {
    ok: false,
    hash,
    sheets: [],
    names: [],
    formulaCount: 0,
    functions: [],
    unsupported: [],
    problems,
    notices: [],
  };

  const entries = zipEntries(bytes);

  if (entries.some((name) => /vbaProject\.bin$|vbaData\.xml$/i.test(name))) {
    problems.push({
      code: "macros",
      message: "The workbook contains macros (VBA). Save it as .xlsx without macros.",
    });
  }

  if (entries.some((name) => /^xl\/externalLinks\//i.test(name))) {
    problems.push({
      code: "external_links",
      message: "The workbook links to other workbooks. Paste the values in instead.",
    });
  }

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch (error) {
    problems.push({
      code: "unreadable",
      message: `This isn't a readable .xlsx file: ${(error as Error).message}`,
    });

    return { ok: false, report };
  }

  const names = readNames(workbook, problems);
  const { sheets, results } = readSheets(workbook, problems);
  const model: WorkbookModel = { hash, sheets, names };
  const engine = new WorkbookEngine(model);

  report.sheets = sheets.map((sheet) => sheet.name);
  report.names = Object.keys(names);
  report.formulaCount = results.size;

  report.functions = [...engine.functionsUsed]
    .map(([name, count]) => ({ name, count, ...functionSupport(name) }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  report.unsupported = report.functions.filter((f) => !f.supported).map((f) => f.name);
  problems.push(...engine.problems);

  for (const fn of report.functions) {
    if (!fn.supported) {
      problems.push({
        code: "unsupported_function",
        message: `${fn.name} ${fn.reason} (used ${fn.count}×)`,
      });
    }
  }

  if (!problems.length) {
    for (const [address, cached] of results) {
      const location = engine.locate(address)!;
      const computed = engine.session().getKey(location.key);

      if (differs(cached, computed)) {
        report.notices.push({
          code: "result_mismatch",
          message: `${address}: Excel saved ${JSON.stringify(cached)}, the engine computes ${JSON.stringify(computed)}`,
          cell: address,
        });
      }
    }
  }

  report.ok = problems.length === 0;

  if (!report.ok) return { ok: false, report };

  warmEngine(model, engine);

  return { ok: true, workbook: model, report };
}

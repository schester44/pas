import FormulaParser, {
  type CellRef,
  type Position,
  type RangeRef,
  type Token,
} from "fast-formula-parser";
import lexing from "fast-formula-parser/grammar/lexing.js";
import { topologicalOrder } from "../graph";
import { formatRange, parseRange, type SheetRange } from "./address";
import { customFunctions, normalizeFunctionName } from "./functions";
import type { CellValue, WorkbookModel, WorkbookProblem } from "./model";

const { DepParser, FormulaError } = FormulaParser;

const SHEET = 2 ** 34;
const ROW = 16384;

interface Bounds {
  sheet: number;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface Formula {
  key: number;
  address: string;
  text: string;
  position: Position;
  tokens: Token[];
  cells: number[];
  ranges: Bounds[];
  refs: { label: string; key?: number }[];
  order: number;
}

export interface CellLocation {
  key: number;
  address: string;
}

const isRange = (ref: CellRef | RangeRef): ref is RangeRef => "from" in ref;

export function toCellValue(raw: unknown): CellValue {
  if (raw instanceof FormulaError) return { error: raw.error };

  if (raw === undefined) return null;

  return raw as CellValue;
}

function fromCellValue(value: CellValue): unknown {
  if (value !== null && typeof value === "object") return new FormulaError(value.error);

  return value;
}

export function normalizeFormula(formula: string): string {
  return formula.replace(/^=/, "").replace(/(_xlfn\.|_xlws\.)+/gi, "");
}

export class WorkbookEngine {
  readonly hash: string;
  readonly problems: WorkbookProblem[] = [];
  readonly functionsUsed = new Map<string, number>();
  readonly formulas: Formula[] = [];
  private readonly formulaByKey = new Map<number, Formula>();
  private readonly sheetNames: string[];
  private readonly sheetIndex = new Map<string, number>();
  private readonly dims: { rows: number; cols: number }[];
  private readonly names = new Map<string, SheetRange>();
  private readonly base = new Map<number, unknown>();
  private readonly cellDependents = new Map<number, number[]>();
  private readonly rangeDependents: (Bounds & { formula: number })[][] = [];
  private readonly downstreamMemo = new Map<number, number[]>();
  private readonly parser: FormulaParser;
  private read: (key: number) => unknown = (key) => this.base.get(key) ?? null;

  constructor(model: WorkbookModel) {
    this.hash = model.hash;
    this.sheetNames = model.sheets.map((sheet) => sheet.name);
    this.dims = model.sheets.map(() => ({ rows: 0, cols: 0 }));

    model.sheets.forEach((sheet, i) => {
      this.sheetIndex.set(sheet.name.toLowerCase(), i);
      this.rangeDependents.push([]);
    });

    for (const [name, range] of Object.entries(model.names))
      this.names.set(name.toLowerCase(), range);

    this.parser = new FormulaParser({
      functions: customFunctions,
      onCell: (ref) => this.cellValue(ref),
      onRange: (ref) => this.rangeValues(ref),
      onVariable: (name) => this.variable(name),
    });

    const pending: { key: number; address: string; text: string; position: Position }[] = [];

    model.sheets.forEach((sheet, index) => {
      for (const [address, cell] of Object.entries(sheet.cells)) {
        const range = parseRange(address, sheet.name);

        if (!range) continue;

        const key = this.keyOf(index, range.from.row, range.from.col);
        this.grow(index, range.from.row, range.from.col);
        this.base.set(key, fromCellValue(cell.value));

        if (cell.formula) {
          pending.push({
            key,
            address: formatRange(range),
            text: normalizeFormula(cell.formula),
            position: { sheet: sheet.name, row: range.from.row, col: range.from.col },
          });
        }
      }
    });

    const parsed = pending.flatMap((cell) => {
      const formula = this.analyze(cell);

      return formula ? [formula] : [];
    });

    this.order(parsed);
  }

  private keyOf(sheet: number, row: number, col: number): number {
    return sheet * SHEET + (row - 1) * ROW + (col - 1);
  }

  private grow(sheet: number, row: number, col: number) {
    const dims = this.dims[sheet]!;
    dims.rows = Math.max(dims.rows, row);
    dims.cols = Math.max(dims.cols, col);
  }

  private sheetOf(name: string | undefined): number | undefined {
    return name === undefined ? undefined : this.sheetIndex.get(name.toLowerCase());
  }

  private variable(name: string): CellRef | RangeRef | null {
    const range = this.names.get(name.toLowerCase());

    if (!range) return null;

    if (range.from.row === range.to.row && range.from.col === range.to.col) {
      return { sheet: range.sheet, ...range.from };
    }

    return { sheet: range.sheet, from: range.from, to: range.to };
  }

  private cellValue(ref: CellRef): unknown {
    const sheet = this.sheetOf(ref.sheet);

    if (sheet === undefined) return FormulaError.REF;

    return this.read(this.keyOf(sheet, ref.row, ref.col));
  }

  private rangeValues(ref: RangeRef): unknown[][] {
    const sheet = this.sheetOf(ref.sheet);

    if (sheet === undefined) return [[FormulaError.REF]];

    const dims = this.dims[sheet]!;
    const lastRow = Math.min(ref.to.row, Math.max(dims.rows, ref.from.row));
    const lastCol = Math.min(ref.to.col, Math.max(dims.cols, ref.from.col));
    const rows: unknown[][] = [];

    for (let row = ref.from.row; row <= lastRow; row++) {
      const values: unknown[] = [];

      for (let col = ref.from.col; col <= lastCol; col++)
        values.push(this.read(this.keyOf(sheet, row, col)));

      rows.push(values);
    }

    return rows;
  }

  private bounds(ref: CellRef | RangeRef, fallback: string): Bounds | undefined {
    const sheet = this.sheetOf(ref.sheet ?? fallback);

    if (sheet === undefined) return undefined;

    if (!isRange(ref)) return { sheet, r1: ref.row, c1: ref.col, r2: ref.row, c2: ref.col };

    return { sheet, r1: ref.from.row, c1: ref.from.col, r2: ref.to.row, c2: ref.to.col };
  }

  private label(bounds: Bounds): string {
    const dims = this.dims[bounds.sheet]!;

    return formatRange({
      sheet: this.sheetNames[bounds.sheet]!,
      from: { row: bounds.r1, col: bounds.c1 },
      to: {
        row: Math.min(bounds.r2, Math.max(dims.rows, bounds.r1)),
        col: Math.min(bounds.c2, Math.max(dims.cols, bounds.c1)),
      },
    });
  }

  private coordinates(key: number) {
    const sheet = Math.floor(key / SHEET);
    const offset = key - sheet * SHEET;

    return { sheet, row: Math.floor(offset / ROW) + 1, col: (offset % ROW) + 1 };
  }

  private dependencies(text: string, position: Position): (CellRef | RangeRef)[] {
    const dep = new DepParser({ onVariable: (name) => this.variable(name) });
    const found: (CellRef | RangeRef)[] = [];

    // The stock collector drops a cell that falls inside an earlier range on another sheet.
    dep.getCell = (ref) => {
      if (ref.row != null) found.push({ ...ref, sheet: ref.sheet ?? dep.position.sheet });

      return 0;
    };

    dep.getRange = (ref) => {
      if (ref.from.row != null) found.push({ ...ref, sheet: ref.sheet ?? dep.position.sheet });

      return [[0]];
    };

    dep.parse(text, position);

    return found;
  }

  private analyze(cell: {
    key: number;
    address: string;
    text: string;
    position: Position;
  }): Formula | undefined {
    const { address, text, position } = cell;

    if (/\[[^\]]*\]/.test(text.replace(/"(?:""|[^"])*"/g, ""))) {
      this.problems.push({
        code: "external_links",
        message: `${address} refers to another workbook`,
        cell: address,
      });

      return undefined;
    }

    let tokens: Token[];
    let refs: (CellRef | RangeRef)[];

    try {
      tokens = lexing.lex(text).tokens;
      refs = this.dependencies(text, position);
    } catch (error) {
      const message =
        (error as Error).message.split("\n").filter(Boolean).at(-1) ?? "doesn't parse";

      this.problems.push({
        code: "formula_error",
        message: `${address}: ${message}`,
        cell: address,
      });

      return undefined;
    }

    for (const token of tokens) {
      if (token.tokenType.name === "Function") {
        const name = normalizeFunctionName(token.image.slice(0, -1));
        this.functionsUsed.set(name, (this.functionsUsed.get(name) ?? 0) + 1);
      }
    }

    const cells: number[] = [];
    const ranges: Bounds[] = [];
    const labels: Formula["refs"] = [];

    for (const ref of refs) {
      const bounds = this.bounds(ref, position.sheet);

      if (!bounds) {
        this.problems.push({
          code: "formula_error",
          message: `${address} refers to a missing sheet`,
          cell: address,
        });

        return undefined;
      }

      const label = this.label(bounds);

      if (labels.some((existing) => existing.label === label)) continue;

      if (isRange(ref)) {
        ranges.push(bounds);
        labels.push({ label });
      } else {
        const key = this.keyOf(bounds.sheet, bounds.r1, bounds.c1);
        cells.push(key);
        labels.push({ label, key });
      }
    }

    return { ...cell, tokens, cells, ranges, refs: labels, order: -1 };
  }

  private order(parsed: Formula[]) {
    const bySheet = new Map<number, Formula[]>();

    for (const formula of parsed) {
      this.formulaByKey.set(formula.key, formula);
      const { sheet } = this.coordinates(formula.key);
      const list = bySheet.get(sheet);

      if (list) list.push(formula);
      else bySheet.set(sheet, [formula]);
    }

    const precedents = new Map<number, number[]>();

    for (const formula of parsed) {
      const list = formula.cells.filter((key) => this.formulaByKey.has(key));

      for (const range of formula.ranges) {
        for (const other of bySheet.get(range.sheet) ?? []) {
          if (this.contains(range, other.key)) list.push(other.key);
        }
      }

      precedents.set(formula.key, list);
    }

    const { order, cyclic } = topologicalOrder(
      parsed.map((f) => f.key),
      (key) => precedents.get(key)!,
    );

    if (cyclic.length) {
      const cells = cyclic.map((key) => this.formulaByKey.get(key)!.address);

      this.problems.push({
        code: "circular_reference",
        message: `Circular references: ${cells.slice(0, 10).join(", ")}${cells.length > 10 ? "…" : ""}`,
        cell: cells[0],
      });

      return;
    }

    for (const key of order) {
      const formula = this.formulaByKey.get(key)!;
      formula.order = this.formulas.length;
      this.formulas.push(formula);
    }

    for (const formula of this.formulas) {
      for (const key of formula.cells) {
        const list = this.cellDependents.get(key);

        if (list) list.push(formula.order);
        else this.cellDependents.set(key, [formula.order]);
      }

      for (const range of formula.ranges)
        this.rangeDependents[range.sheet]!.push({ ...range, formula: formula.order });
    }

    for (const formula of this.formulas) this.base.set(formula.key, this.evaluate(formula));
  }

  private contains(range: Bounds, key: number): boolean {
    const { sheet, row, col } = this.coordinates(key);

    return (
      sheet === range.sheet &&
      row >= range.r1 &&
      row <= range.r2 &&
      col >= range.c1 &&
      col <= range.c2
    );
  }

  private directDependents(key: number): number[] {
    const { sheet } = this.coordinates(key);
    const direct = [...(this.cellDependents.get(key) ?? [])];

    for (const range of this.rangeDependents[sheet] ?? []) {
      if (this.contains(range, key)) direct.push(range.formula);
    }

    return direct;
  }

  downstream(key: number): number[] {
    const memo = this.downstreamMemo.get(key);

    if (memo) return memo;

    const seen = new Set<number>();
    const stack = this.directDependents(key);

    while (stack.length) {
      const order = stack.pop()!;

      if (seen.has(order)) continue;

      seen.add(order);
      stack.push(...this.directDependents(this.formulas[order]!.key));
    }

    const result = [...seen].toSorted((a, b) => a - b);
    this.downstreamMemo.set(key, result);

    return result;
  }

  upstream(key: number): number[] {
    const seen = new Set<number>();
    const stack = [key];

    while (stack.length) {
      const formula = this.formulaByKey.get(stack.pop()!);

      if (!formula || seen.has(formula.order)) continue;

      seen.add(formula.order);
      stack.push(...formula.cells);

      for (const range of formula.ranges) {
        for (const other of this.formulas)
          if (this.contains(range, other.key)) stack.push(other.key);
      }
    }

    return [...seen].toSorted((a, b) => a - b);
  }

  formulaAt(key: number): Formula | undefined {
    return this.formulaByKey.get(key);
  }

  locate(target: string): CellLocation | undefined {
    const named = this.names.get(target.toLowerCase());
    const range = named ?? parseRange(target);

    if (!range || range.from.row !== range.to.row || range.from.col !== range.to.col)
      return undefined;

    const sheet = this.sheetOf(range.sheet);

    if (sheet === undefined) return undefined;

    return {
      key: this.keyOf(sheet, range.from.row, range.from.col),
      address: formatRange({ ...range, sheet: this.sheetNames[sheet]! }),
    };
  }

  addressOf(key: number): string {
    const { sheet, row, col } = this.coordinates(key);

    return formatRange({ sheet: this.sheetNames[sheet]!, from: { row, col }, to: { row, col } });
  }

  baseValue(key: number): unknown {
    return this.base.get(key) ?? null;
  }

  evaluate(formula: Formula, read?: (key: number) => unknown): unknown {
    const previous = this.read;

    if (read) this.read = read;

    try {
      const parser = this.parser;
      parser.position = formula.position;
      parser.async = false;
      parser.parser.input = formula.tokens;
      const result = parser.checkFormulaResult(parser.parser.formulaWithBinaryOp());

      return result ?? 0;
    } catch (error) {
      return error instanceof FormulaError ? error : new FormulaError("#VALUE!");
    } finally {
      this.read = previous;
    }
  }

  ensureCapacity(key: number) {
    const { sheet, row, col } = this.coordinates(key);
    this.grow(sheet, row, col);
  }

  session(): RecalcSession {
    return new RecalcSession(this);
  }
}

export class RecalcSession {
  private readonly values = new Map<number, unknown>();
  private readonly changed = new Set<number>();

  constructor(private readonly engine: WorkbookEngine) {}

  private read = (key: number): unknown =>
    this.values.has(key) ? this.values.get(key) : this.engine.baseValue(key);

  private locate(target: string): CellLocation {
    const location = this.engine.locate(target);

    if (!location) throw new Error(`${target} isn't a cell or single-cell name in this workbook`);

    return location;
  }

  set(target: string, value: CellValue) {
    this.setKey(this.locate(target).key, value);
  }

  setKey(key: number, value: CellValue) {
    if (this.engine.formulaAt(key))
      throw new Error(`${this.engine.addressOf(key)} holds a formula`);

    const raw = fromCellValue(value);

    if (this.read(key) === raw) return;

    this.engine.ensureCapacity(key);
    this.values.set(key, raw);
    this.changed.add(key);
  }

  recalculate(): string[] {
    const dirty = new Set<number>();

    for (const key of this.changed)
      for (const order of this.engine.downstream(key)) dirty.add(order);

    this.changed.clear();

    const recalculated: string[] = [];

    for (const order of [...dirty].toSorted((a, b) => a - b)) {
      const formula = this.engine.formulas[order]!;
      this.values.set(formula.key, this.engine.evaluate(formula, this.read));
      recalculated.push(formula.address);
    }

    return recalculated;
  }

  get(target: string): CellValue {
    return toCellValue(this.read(this.locate(target).key));
  }

  getKey(key: number): CellValue {
    return toCellValue(this.read(key));
  }
}
